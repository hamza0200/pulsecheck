import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { STRONG_PASSWORD, refreshCookieFrom, signupAdmin, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(resetDb);

describe('GET/PATCH /api/account', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/account')).status).toBe(401);
  });

  it('returns the account and updates alertsEnabled', async () => {
    const { accessToken } = await signupUser(app, 'acct@example.com');

    const get = await request(app).get('/api/account').set(auth(accessToken));
    expect(get.status).toBe(200);
    expect(get.body.account).toMatchObject({ email: 'acct@example.com', alertsEnabled: true });
    expect(get.body.account).not.toHaveProperty('passwordHash');

    const patch = await request(app)
      .patch('/api/account')
      .set(auth(accessToken))
      .send({ alertsEnabled: false });
    expect(patch.status).toBe(200);
    expect(patch.body.account.alertsEnabled).toBe(false);
  });

  it('rejects unknown fields so users cannot change their own role', async () => {
    const { accessToken } = await signupUser(app);
    const res = await request(app)
      .patch('/api/account')
      .set(auth(accessToken))
      .send({ alertsEnabled: true, role: 'ADMIN' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/account/change-password', () => {
  it('requires the correct current password', async () => {
    const { accessToken } = await signupUser(app);
    const res = await request(app)
      .post('/api/account/change-password')
      .set(auth(accessToken))
      .send({ currentPassword: 'wrong-password-1', newPassword: 'another-good-password' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
  });

  it('changes the password and revokes other sessions but keeps this one', async () => {
    const current = await signupUser(app, 'change@example.com');
    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'change@example.com', password: STRONG_PASSWORD });
    const otherCookie = refreshCookieFrom(otherLogin)!;

    const res = await request(app)
      .post('/api/account/change-password')
      .set(auth(current.accessToken))
      .send({ currentPassword: STRONG_PASSWORD, newPassword: 'another-good-password' });
    expect(res.status).toBe(200);

    expect((await request(app).post('/api/auth/refresh').set('Cookie', otherCookie)).status).toBe(
      401,
    );
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', current.cookie)).status,
    ).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'change@example.com', password: 'another-good-password' });
    expect(login.status).toBe(200);
  });
});

describe('DELETE /api/account', () => {
  it('requires the password, then deletes the user and their data', async () => {
    const { accessToken, user } = await signupUser(app);
    await prisma.monitor.create({
      data: { userId: user.id, name: 'example', url: 'https://example.com' },
    });

    const wrong = await request(app)
      .delete('/api/account')
      .set(auth(accessToken))
      .send({ password: 'not-my-password' });
    expect(wrong.status).toBe(400);

    const res = await request(app)
      .delete('/api/account')
      .set(auth(accessToken))
      .send({ password: STRONG_PASSWORD });
    expect(res.status).toBe(204);

    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.monitor.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('refuses to delete the last admin', async () => {
    const { accessToken } = await signupAdmin(app);
    const res = await request(app)
      .delete('/api/account')
      .set(auth(accessToken))
      .send({ password: STRONG_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });
});
