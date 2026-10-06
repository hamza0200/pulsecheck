import { badRequest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { mailer } from '../../lib/mailer.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js';
import { passwordResetEmail } from './auth.emails.js';
import {
  passwordResetRepository,
  refreshTokenRepository,
  userRepository,
} from './auth.repository.js';

export const RESET_TOKEN_TTL_MINUTES = 30;

export const FORGOT_PASSWORD_MESSAGE =
  "If an account exists for that email, we've sent a link to reset the password.";

const invalidToken = () =>
  badRequest(
    'INVALID_OR_EXPIRED_TOKEN',
    'This reset link is invalid or has expired. Please request a new one.',
  );

export const passwordResetService = {
  /**
   * Always resolves the same way whether or not the email exists, so the endpoint can't
   * be used to discover which emails have accounts.
   */
  async requestReset(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email);
    if (!user || user.isDisabled) {
      logger.info('Password reset requested for an unknown or disabled account');
      return;
    }

    const token = generateOpaqueToken();
    await prisma.$transaction(async (tx) => {
      await passwordResetRepository.deleteUnusedForUser(user.id, tx);
      await passwordResetRepository.create(
        {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
        },
        tx,
      );
    });

    // [Node concept: event loop] We don't await the SMTP round-trip: the response goes out
    // immediately (and takes about as long as for an unknown email), while the email is
    // sent in the background. Failures are logged, not thrown.
    mailer.sendInBackground(passwordResetEmail(user.email, token, RESET_TOKEN_TTL_MINUTES));
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await passwordResetRepository.findUsable(hashToken(token));
    if (!record || record.user.isDisabled) throw invalidToken();

    const passwordHash = await hashPassword(newPassword);
    const succeeded = await prisma.$transaction(async (tx) => {
      // Conditional update: if two requests race with the same token, only one wins.
      if (!(await passwordResetRepository.markUsed(record.id, tx))) return false;
      await userRepository.updatePassword(record.userId, passwordHash, tx);
      // Whoever knew the old password may have live sessions: end them all.
      await refreshTokenRepository.revokeAllForUser(record.userId, tx);
      return true;
    });
    if (!succeeded) throw invalidToken();
  },
};
