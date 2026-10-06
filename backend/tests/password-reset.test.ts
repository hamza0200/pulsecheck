/**
 * Forgot / reset password flow (integration, test DB, mailer mocked).
 * - Forgot-password gives the same response for known and unknown emails (no enumeration)
 * - Only existing users get an email; only the token's SHA-256 hash is stored; 30-minute expiry
 * - Disabled users get no email
 * - Requesting a new link invalidates older unused links
 * - An SMTP failure still returns 200
 * - Reset sets the new password, works only once, and revokes existing sessions
 * - Expired, unknown and malformed tokens are rejected
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashToken } from '../src/lib/tokens.js';
import { refreshCookieFrom, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { mockMailer, resetTokenFrom, sentMessages } from './helpers/mail.js';

const app = createApp();
const NEW_PASSWORD = 'brand-new-password-42';
let mailSpy: ReturnType<typeof mockMailer>;

beforeEach(async () => {
  await resetDb();
  mailSpy = mockMailer();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function requestReset(email: string) {
  return request(app).post('/api/auth/forgot-password').send({ email });
}

/** Requests a reset for `email` and returns the token from the (mocked) email. */
async function obtainResetToken(email: string): Promise<string> {
  await requestReset(email);
  await vi.waitFor(() => expect(mailSpy).toHaveBeenCalled());
  return resetTokenFrom(sentMessages(mailSpy).at(-1)!);
}

describe('POST /api/auth/forgot-password', () => {
  it('returns the identical response for known and unknown emails', async () => {
    await signupUser(app, 'known@example.com');
    const known = await requestReset('known@example.com');
    const unknown = await requestReset('unknown@example.com');

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.message).toMatch(/If an account exists/);
  });

  it('emails a reset link only to existing users and stores only the token hash', async () => {
    const { user } = await signupUser(app, 'known@example.com');
    await requestReset('unknown@example.com');
    const token = await obtainResetToken('Known@Example.com');

    const messages = sentMessages(mailSpy);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.to).toBe('known@example.com');
    expect(messages[0]!.text).toContain(`http://localhost:5173/reset-password?token=${token}`);

    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toBe(token);
    const minutes = (stored.expiresAt.getTime() - stored.createdAt.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(30, 0);
  });

  it('does not email disabled users', async () => {
    const { user } = await signupUser(app, 'off@example.com');
    await prisma.user.update({ where: { id: user.id }, data: { isDisabled: true } });
    expect((await requestReset('off@example.com')).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('invalidates older unused tokens when a new one is requested', async () => {
    await signupUser(app, 'twice@example.com');
    const first = await obtainResetToken('twice@example.com');
    mailSpy.mockClear();
    const second = await obtainResetToken('twice@example.com');

    const old = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: first, password: NEW_PASSWORD });
    expect(old.status).toBe(400);

    const fresh = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: second, password: NEW_PASSWORD });
    expect(fresh.status).toBe(200);
  });

  it('still answers 200 when the email server is down', async () => {
    mailSpy.mockRejectedValue(new Error('SMTP down'));
    await signupUser(app, 'smtp@example.com');
    expect((await requestReset('smtp@example.com')).status).toBe(200);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password, works once, and revokes existing sessions', async () => {
    const { cookie } = await signupUser(app, 'reset@example.com');
    const token = await obtainResetToken('reset@example.com');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);

    // Old session is gone.
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);

    // New password works, old one doesn't.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(refreshCookieFrom(login)).toBeDefined();

    // Same token a second time is rejected.
    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'another-password-99' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an expired token', async () => {
    await signupUser(app, 'late@example.com');
    const token = await obtainResetToken('late@example.com');
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an unknown token and validates the new password', async () => {
    const unknown = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'x'.repeat(43), password: NEW_PASSWORD });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    const weak = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'x'.repeat(43), password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });
});
