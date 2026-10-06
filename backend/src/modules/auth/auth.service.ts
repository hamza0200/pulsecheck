import { randomUUID } from 'node:crypto';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import {
  REFRESH_TOKEN_TTL_MS,
  hashToken,
  safeEqual,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/tokens.js';
import { type PublicUser, refreshTokenRepository, userRepository } from './auth.repository.js';
import type { LoginInput, SignupInput } from './auth.schemas.js';

export interface Session {
  accessToken: string;
  /** Raw refresh token: goes into the httpOnly cookie, never into a response body. */
  refreshToken: string;
  user: PublicUser;
}

export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
export const accountDisabled = () =>
  forbidden('ACCOUNT_DISABLED', 'This account has been disabled. Contact the administrator.');
const invalidRefreshToken = () =>
  unauthorized('INVALID_REFRESH_TOKEN', 'Your session has expired, please log in again');

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, role: user.role, alertsEnabled: user.alertsEnabled };
}

/** Creates a refresh token (in an existing family or a new one) and an access token. */
async function issueSession(
  user: User,
  familyId: string = randomUUID(),
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Session> {
  const tokenId = randomUUID();
  const refreshToken = signRefreshToken({ userId: user.id, tokenId, familyId });
  await refreshTokenRepository.create(
    {
      id: tokenId,
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
    db,
  );
  return {
    accessToken: signAccessToken(user, familyId),
    refreshToken,
    user: toPublicUser(user),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const authService = {
  async signup(input: SignupInput): Promise<Session> {
    const emailTaken = () => conflict('EMAIL_TAKEN', 'An account with this email already exists');
    if (await userRepository.findByEmail(input.email)) throw emailTaken();

    const passwordHash = await hashPassword(input.password);
    try {
      // Role is never taken from input: signup can only ever create a USER.
      const user = await userRepository.create({ email: input.email, passwordHash, role: 'USER' });
      return await issueSession(user);
    } catch (err) {
      // Two signups racing for the same email: the unique index decides the winner.
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }
  },

  async login(input: LoginInput): Promise<Session> {
    const user = await userRepository.findByEmail(input.email);
    if (!user) {
      await burnPasswordCheck(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) throw invalidCredentials();
    // Only reveal "disabled" to someone who proved they know the password.
    if (user.isDisabled) throw accountDisabled();
    return issueSession(user);
  },

  /**
   * Rotates a refresh token: the presented token is revoked and a new one in the same
   * family is issued. Presenting an already-revoked token means it was copied (stolen),
   * so the whole family is revoked and both the thief and the user must log in again.
   */
  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken) throw invalidRefreshToken();
    const payload = verifyRefreshToken(rawToken);
    if (!payload) throw invalidRefreshToken();

    const record = await refreshTokenRepository.findById(payload.jti);
    if (!record || !safeEqual(record.tokenHash, hashToken(rawToken))) throw invalidRefreshToken();

    if (record.revokedAt) {
      // If the family still had a live token, someone rotated this token and someone else
      // is now replaying the old copy: likely theft, so kill the family. If nothing was
      // live, the token was revoked on purpose (logout, password reset, account disabled)
      // and this is just a stale cookie.
      const { count } = await refreshTokenRepository.revokeFamily(record.familyId);
      if (count === 0) throw invalidRefreshToken();
      logger.warn(
        { userId: record.userId, familyId: record.familyId },
        'Refresh token reuse detected; revoked token family',
      );
      throw unauthorized('REFRESH_TOKEN_REUSED', 'Your session was ended, please log in again');
    }
    if (record.expiresAt <= new Date()) throw invalidRefreshToken();

    const user = await userRepository.findById(record.userId);
    if (!user) throw invalidRefreshToken();
    if (user.isDisabled) throw accountDisabled();

    // [Node concept: database transactions] Revoking the old token and creating the new
    // one must both happen or neither: otherwise a crash in between could log the user out
    // or leave two valid tokens.
    const session = await prisma.$transaction(async (tx) => {
      const revokedNow = await refreshTokenRepository.revokeIfActive(record.id, tx);
      if (!revokedNow) return null; // Another request rotated it a moment ago.
      return issueSession(user, record.familyId, tx);
    });
    if (!session) {
      await refreshTokenRepository.revokeFamily(record.familyId);
      throw unauthorized('REFRESH_TOKEN_REUSED', 'Your session was ended, please log in again');
    }
    return session;
  },

  /** Revokes the presented refresh token if it is valid. Never throws for bad tokens. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const payload = verifyRefreshToken(rawToken);
    if (!payload) return;
    const record = await refreshTokenRepository.findById(payload.jti);
    if (record && safeEqual(record.tokenHash, hashToken(rawToken))) {
      await refreshTokenRepository.revokeIfActive(record.id);
    }
  },
};
