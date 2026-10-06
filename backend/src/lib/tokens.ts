import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// [Node concept: crypto] randomBytes uses the OS CSPRNG, unlike Math.random().
// 32 bytes = 256 bits of entropy, encoded URL-safe for links and query strings.
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// [Node concept: crypto] We store only a SHA-256 hash of each token. A leaked database
// then contains nothing usable. A fast hash is fine here (unlike passwords) because the
// tokens are long random values that cannot be brute-forced.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// [Node concept: crypto] `a === b` stops at the first differing character, so response
// time leaks how much of a secret matched. timingSafeEqual always compares every byte.
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ---- Access tokens (short-lived JWT, sent as a Bearer header, kept in memory) ----

const accessPayloadSchema = z.object({
  sub: z.string(),
  role: z.enum(['USER', 'ADMIN']),
  /** Session id: the refresh-token family this access token was issued from. */
  sid: z.string(),
  typ: z.literal('access'),
});
export type AccessTokenPayload = z.infer<typeof accessPayloadSchema>;

export function signAccessToken(
  user: { id: string; role: 'USER' | 'ADMIN' },
  sessionId: string,
): string {
  return jwt.sign({ role: user.role, sid: sessionId, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

/** Returns the payload, or null if the token is invalid or expired. */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    const parsed = accessPayloadSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---- Refresh tokens (7-day JWT in an httpOnly cookie, hashed in the database) ----

const refreshPayloadSchema = z.object({
  sub: z.string(),
  jti: z.string(),
  fam: z.string(),
  typ: z.literal('refresh'),
});
export type RefreshTokenPayload = z.infer<typeof refreshPayloadSchema>;

export function signRefreshToken(input: { userId: string; tokenId: string; familyId: string }) {
  return jwt.sign({ fam: input.familyId, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    subject: input.userId,
    jwtid: input.tokenId,
    expiresIn: REFRESH_TOKEN_TTL_MS / 1000,
    algorithm: 'HS256',
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    const parsed = refreshPayloadSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
