/**
 * Auth API: signup, login, refresh, logout, me (integration, Supertest + test DB).
 * - Signup: creates a USER, hashes the password, sets an httpOnly/SameSite=Lax refresh cookie
 * - Signup can never create an admin, even if the body sends role: ADMIN
 * - Signup validation: short/common passwords and bad emails
 * - Duplicate email (any letter case) returns 409 EMAIL_TAKEN
 * - Login works; wrong password and unknown email return the identical 401
 * - Disabled user gets 403 ACCOUNT_DISABLED
 * - Login rate limit: the 11th attempt in 15 minutes returns 429
 * - Refresh rotates the token; reusing a rotated token revokes the whole family
 * - Refresh rejects missing/garbage cookies and disabled users
 * - Logout revokes the token and clears the cookie
 * - GET /me: works with a token, 401 without, 403 once the user is disabled
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { resetDb } from './helpers/db.js';
import { STRONG_PASSWORD, refreshCookieFrom, signupUser } from './helpers/auth.js';

const app = createApp();

beforeEach(resetDb);

describe('POST /api/auth/signup', () => {
  it('creates a USER, returns an access token and sets a secure refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: '  New.User@Example.COM ', password: STRONG_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'new.user@example.com', role: 'USER' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/pc_refresh=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\/api\/auth/);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: 'new.user@example.com' },
    });
    expect(stored.passwordHash).not.toContain(STRONG_PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('can never create an admin, even if the body asks for it', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'sneaky@example.com', password: STRONG_PASSWORD, role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
  });

  it('rejects short and common passwords and bad emails', async () => {
    const short = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'a@example.com', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect(short.body.error.details.fieldErrors.password[0]).toMatch(/at least 10/);

    const common = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'a@example.com', password: 'Password123' });
    expect(common.status).toBe(400);
    expect(common.body.error.details.fieldErrors.password[0]).toMatch(/too common/);

    const badEmail = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: STRONG_PASSWORD });
    expect(badEmail.status).toBe(400);
  });

  it('returns 409 EMAIL_TAKEN for a duplicate email, regardless of case', async () => {
    await signupUser(app, 'dup@example.com');
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'DUP@example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await signupUser(app, 'login@example.com');
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Login@Example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookieFrom(res)).toBeDefined();
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrong-password-123' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: STRONG_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 403 ACCOUNT_DISABLED for a disabled user', async () => {
    await prisma.user.update({ where: { email: 'login@example.com' }, data: { isDisabled: true } });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_IN_TESTS = 'true';
    });
    afterEach(() => {
      delete process.env.RATE_LIMIT_IN_TESTS;
    });

    it('blocks the 11th attempt for the same email within 15 minutes', async () => {
      const attempt = () =>
        request(app)
          .post('/api/auth/login')
          .send({ email: 'ratelimited@example.com', password: 'whatever-123' });
      for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    });
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and the old one stops working', async () => {
    const { cookie: first } = await signupUser(app);

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', first);
    expect(rotated.status).toBe(200);
    expect(rotated.body.accessToken).toEqual(expect.any(String));
    const second = refreshCookieFrom(rotated);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    const again = await request(app).post('/api/auth/refresh').set('Cookie', second!);
    expect(again.status).toBe(200);
  });

  it('reuse of a revoked token revokes the whole family', async () => {
    const { cookie: original, user } = await signupUser(app);
    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original);
    const current = refreshCookieFrom(rotated)!;

    // An attacker replays the old (already rotated) token.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate user's current token is now dead too.
    const legit = await request(app).post('/api/auth/refresh').set('Cookie', current);
    expect(legit.status).toBe(401);

    const active = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it('rejects a missing or garbage cookie', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    const garbage = await request(app).post('/api/auth/refresh').set('Cookie', 'pc_refresh=nope');
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refuses to refresh for a disabled user', async () => {
    const { cookie, user } = await signupUser(app);
    await prisma.user.update({ where: { id: user.id }, data: { isDisabled: true } });
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const { cookie } = await signupUser(app);
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(
      /pc_refresh=;.*Expires=Thu, 01 Jan 1970/,
    );

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('succeeds even without a cookie', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user for a valid access token', async () => {
    const { accessToken } = await signupUser(app, 'me@example.com');
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: 'me@example.com',
      role: 'USER',
      alertsEnabled: true,
    });
  });

  it('returns 401 without a token or with a bad token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(bad.status).toBe(401);
  });

  it('rejects a still-valid access token once the user is disabled', async () => {
    const { accessToken, user } = await signupUser(app);
    await prisma.user.update({ where: { id: user.id }, data: { isDisabled: true } });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });
});
