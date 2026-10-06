/**
 * Admin API: stats, users list, disable/enable (integration, test DB).
 * - Unauthenticated requests get 401; non-admins get 403 on every admin endpoint
 * - Role comes from the database: a demoted admin loses access with a still-valid token
 * - GET /stats: user, monitor-status and 24h-check counts plus the last run summary
 * - GET /users: newest first with monitor counts, never exposes password hashes or tokens
 * - GET /users: case-insensitive email search and cursor pagination
 * - PATCH /users/:id disables a user: their refresh tokens are revoked, login and API access stop
 * - PATCH re-enables a user so they can log in again
 * - An admin cannot disable themselves; unknown ids return 404; unknown fields are rejected
 * - Disabling a user emits user.disabled (closes their live-update streams)
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { events } from '../src/lib/events.js';
import { prisma } from '../src/lib/prisma.js';
import { STRONG_PASSWORD, type TestSession, signupAdmin, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

const app = createApp();
const as = (s: TestSession) => ({ Authorization: `Bearer ${s.accessToken}` });
let admin: TestSession;
let user: TestSession;

beforeEach(async () => {
  await resetDb();
  admin = await signupAdmin(app, 'admin@example.com');
  user = await signupUser(app, 'user@example.com');
});

describe('access control', () => {
  const endpoints = [
    { method: 'get', path: '/api/admin/stats' },
    { method: 'get', path: '/api/admin/users' },
    { method: 'patch', path: '/api/admin/users/00000000-0000-4000-8000-000000000000' },
  ] as const;

  it('returns 401 without a token', async () => {
    for (const { method, path } of endpoints) {
      expect((await request(app)[method](path).send({ isDisabled: true })).status).toBe(401);
    }
  });

  it('returns 403 ADMIN_ONLY for a normal user', async () => {
    for (const { method, path } of endpoints) {
      const res = await request(app)[method](path).set(as(user)).send({ isDisabled: true });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ADMIN_ONLY');
    }
  });

  it('checks the role in the database, so demotion takes effect immediately', async () => {
    expect((await request(app).get('/api/admin/stats').set(as(admin))).status).toBe(200);
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'USER' } });
    // Same access token (it still says role ADMIN), but the database now disagrees.
    expect((await request(app).get('/api/admin/stats').set(as(admin))).status).toBe(403);
  });
});

describe('GET /api/admin/stats', () => {
  it('reports users, monitors by status and checks in the last 24h', async () => {
    const make = (url: string, data: Record<string, unknown> = {}) =>
      prisma.monitor.create({ data: { userId: user.user.id, name: url, url, ...data } });
    const upMonitor = await make('https://a.example', { currentStatus: 'UP' });
    await make('https://b.example', { currentStatus: 'DOWN' });
    await make('https://c.example', { isPaused: true });
    await prisma.check.createMany({
      data: [
        { monitorId: upMonitor.id, isUp: true },
        { monitorId: upMonitor.id, isUp: true },
        { monitorId: upMonitor.id, isUp: true, checkedAt: new Date(Date.now() - 2 * 86_400_000) },
      ],
    });
    await prisma.user.update({ where: { id: user.user.id }, data: { isDisabled: true } });

    const res = await request(app).get('/api/admin/stats').set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      users: { total: 2, admins: 1, disabled: 1 },
      monitors: { total: 3, up: 1, down: 1, unknown: 1, paused: 1 },
      checksLast24h: 2,
      schedulerEnabled: false,
    });
    expect(res.body).toHaveProperty('lastRun');
  });
});

describe('GET /api/admin/users', () => {
  it('lists users newest first with monitor counts and no secrets', async () => {
    await prisma.monitor.create({
      data: { userId: user.user.id, name: 'x', url: 'https://x.example' },
    });
    const res = await request(app).get('/api/admin/users').set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { email: string }) => u.email)).toEqual([
      'user@example.com',
      'admin@example.com',
    ]);
    expect(res.body.users[0]).toEqual({
      id: user.user.id,
      email: 'user@example.com',
      role: 'USER',
      isDisabled: false,
      createdAt: expect.any(String),
      monitorCount: 1,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|\$2[aby]\$/);
    expect(res.body.nextCursor).toBeNull();
  });

  it('searches emails case-insensitively and paginates with a cursor', async () => {
    for (let i = 0; i < 5; i++) await signupUser(app, `team-${i}@corp.example`);

    const search = await request(app)
      .get('/api/admin/users')
      .query({ search: 'CORP' })
      .set(as(admin));
    expect(search.body.users).toHaveLength(5);

    const emails: string[] = [];
    let cursor: string | null = null;
    do {
      const page: request.Response = await request(app)
        .get('/api/admin/users')
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .set(as(admin));
      emails.push(...page.body.users.map((u: { email: string }) => u.email));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(emails).toHaveLength(7);
    expect(new Set(emails).size).toBe(7);
  });
});

describe('PATCH /api/admin/users/:id', () => {
  it('disabling revokes sessions and blocks login, refresh and API access', async () => {
    const emitted = vi.fn();
    events.on('user.disabled', emitted);
    const res = await request(app)
      .patch(`/api/admin/users/${user.user.id}`)
      .set(as(admin))
      .send({ isDisabled: true });
    events.off('user.disabled', emitted);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.user.id, isDisabled: true });
    expect(emitted).toHaveBeenCalledWith({ userId: user.user.id });
    expect(
      await prisma.refreshToken.count({ where: { userId: user.user.id, revokedAt: null } }),
    ).toBe(0);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', user.cookie);
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe('INVALID_REFRESH_TOKEN'); // revoked on purpose, not theft
    expect((await request(app).get('/api/monitors').set(as(user))).status).toBe(403);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: STRONG_PASSWORD });
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('re-enabling lets the user log in again', async () => {
    await prisma.user.update({ where: { id: user.user.id }, data: { isDisabled: true } });
    const res = await request(app)
      .patch(`/api/admin/users/${user.user.id}`)
      .set(as(admin))
      .send({ isDisabled: false });
    expect(res.body.user.isDisabled).toBe(false);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('an admin cannot disable themselves', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${admin.user.id}`)
      .set(as(admin))
      .send({ isDisabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_DISABLE_SELF');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    expect(stored.isDisabled).toBe(false);
  });

  it('returns 404 for an unknown user and 400 for unknown fields', async () => {
    const unknown = await request(app)
      .patch('/api/admin/users/00000000-0000-4000-8000-000000000000')
      .set(as(admin))
      .send({ isDisabled: true });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');

    const extra = await request(app)
      .patch(`/api/admin/users/${user.user.id}`)
      .set(as(admin))
      .send({ isDisabled: false, role: 'ADMIN' });
    expect(extra.status).toBe(400);
  });
});
