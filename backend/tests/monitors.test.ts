/**
 * Monitors API (integration, test DB; DNS faked so no network is needed).
 * - CRUD: create with defaults + URL normalisation, list (own monitors + usage), update, pause, delete
 * - Changing the URL resets status and resolves the open incident
 * - Duplicate URL per user returns 409; the same URL for another user is fine
 * - Validation: 5-minute minimum interval, timeout bounds, unknown fields, bad URLs, protocols
 * - SSRF: private targets refused on create and on update
 * - Per-user limit (MAX_MONITORS_PER_USER), including under concurrent creates
 * - IDOR: user A gets 404 on every endpoint for user B's monitor
 * - Uptime 24h/7d/30d + average response computed with SQL aggregates
 * - The list includes each monitor's last 30 checks (oldest first) for the status strip
 * - Cursor pagination of checks (newest first), `since` filter, invalid cursor
 * - Incidents listed newest first
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { type TestSession, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

vi.mock('node:dns/promises', async () => (await import('./helpers/dns.js')).dnsMockModule);

const app = createApp();
let alice: TestSession;
let bob: TestSession;

const as = (session: TestSession) => ({ Authorization: `Bearer ${session.accessToken}` });

async function createMonitor(session: TestSession, body: Record<string, unknown>) {
  return request(app).post('/api/monitors').set(as(session)).send(body);
}

beforeEach(async () => {
  await resetDb();
  alice = await signupUser(app, 'alice@example.com');
  bob = await signupUser(app, 'bob@example.com');
});

describe('monitors CRUD', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/monitors')).status).toBe(401);
  });

  it('creates a monitor with defaults and a normalised URL', async () => {
    const res = await createMonitor(alice, { url: 'https://WWW.Example.com/#top' });
    expect(res.status).toBe(201);
    expect(res.body.monitor).toMatchObject({
      name: 'example.com',
      url: 'https://www.example.com',
      intervalMinutes: 10,
      timeoutMs: 10000,
      isPaused: false,
      currentStatus: 'UNKNOWN',
    });
    expect(res.body.monitor).not.toHaveProperty('userId');
  });

  it('lists only the caller’s monitors with usage', async () => {
    await createMonitor(alice, { url: 'https://example.com', name: 'Alice site' });
    await createMonitor(bob, { url: 'https://example.org', name: 'Bob site' });

    const res = await request(app).get('/api/monitors').set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.monitors).toHaveLength(1);
    expect(res.body.monitors[0]).toMatchObject({
      name: 'Alice site',
      uptime24h: null,
      lastCheck: null,
    });
    expect(res.body.usage).toEqual({ used: 1, max: env.MAX_MONITORS_PER_USER });
  });

  it('updates, pauses and deletes', async () => {
    const { body } = await createMonitor(alice, { url: 'https://example.com' });
    const id = body.monitor.id as string;

    const patch = await request(app)
      .patch(`/api/monitors/${id}`)
      .set(as(alice))
      .send({ name: 'Renamed', intervalMinutes: 15, isPaused: true });
    expect(patch.status).toBe(200);
    expect(patch.body.monitor).toMatchObject({
      name: 'Renamed',
      intervalMinutes: 15,
      isPaused: true,
    });

    const del = await request(app).delete(`/api/monitors/${id}`).set(as(alice));
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/monitors/${id}`).set(as(alice))).status).toBe(404);
  });

  it('changing the URL resets status and resolves an open incident', async () => {
    const { body } = await createMonitor(alice, { url: 'https://example.com' });
    const id = body.monitor.id as string;
    await prisma.monitor.update({
      where: { id },
      data: { currentStatus: 'DOWN', consecutiveFailures: 3, lastCheckedAt: new Date() },
    });
    await prisma.incident.create({ data: { monitorId: id, cause: 'HTTP 500' } });

    const res = await request(app)
      .patch(`/api/monitors/${id}`)
      .set(as(alice))
      .send({ url: 'https://example.org' });
    expect(res.status).toBe(200);
    expect(res.body.monitor).toMatchObject({
      url: 'https://example.org',
      currentStatus: 'UNKNOWN',
      consecutiveFailures: 0,
      lastCheckedAt: null,
    });
    expect(await prisma.incident.count({ where: { monitorId: id, resolvedAt: null } })).toBe(0);
  });

  it('rejects a duplicate URL for the same user but allows it for another user', async () => {
    await createMonitor(alice, { url: 'https://example.com' });
    const dup = await createMonitor(alice, { url: 'https://example.com/' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('MONITOR_EXISTS');
    expect((await createMonitor(bob, { url: 'https://example.com' })).status).toBe(201);
  });
});

describe('validation', () => {
  it('enforces the 5-minute minimum interval and timeout bounds', async () => {
    const res = await createMonitor(alice, { url: 'https://example.com', intervalMinutes: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.intervalMinutes[0]).toMatch(/5 minutes/);

    const timeout = await createMonitor(alice, { url: 'https://example.com', timeoutMs: 60_000 });
    expect(timeout.status).toBe(400);
  });

  it('rejects unknown fields, bad URLs and non-http protocols', async () => {
    expect(
      (await createMonitor(alice, { url: 'https://example.com', userId: bob.user.id })).status,
    ).toBe(400);
    expect((await createMonitor(alice, { url: 'not a url' })).status).toBe(400);
    const ftp = await createMonitor(alice, { url: 'ftp://example.com' });
    expect(ftp.status).toBe(400);
    expect(ftp.body.error.code).toBe('UNSUPPORTED_PROTOCOL');
  });

  it('refuses private targets on create and on update (SSRF)', async () => {
    const internal = await createMonitor(alice, { url: 'http://internal.example' });
    expect(internal.status).toBe(400);
    expect(internal.body.error.code).toBe('PRIVATE_ADDRESS');
    expect(internal.body.error.details.fieldErrors.url).toHaveLength(1);

    expect((await createMonitor(alice, { url: 'http://169.254.169.254' })).status).toBe(400);

    const { body } = await createMonitor(alice, { url: 'https://example.com' });
    const update = await request(app)
      .patch(`/api/monitors/${body.monitor.id}`)
      .set(as(alice))
      .send({ url: 'http://127.0.0.1' });
    expect(update.status).toBe(400);
    expect(update.body.error.code).toBe('PRIVATE_ADDRESS');
  });

  it('returns 400 for a malformed monitor id', async () => {
    expect((await request(app).get('/api/monitors/not-a-uuid').set(as(alice))).status).toBe(400);
  });
});

describe('per-user limit', () => {
  it(`allows at most MAX_MONITORS_PER_USER monitors`, async () => {
    await prisma.monitor.createMany({
      data: Array.from({ length: env.MAX_MONITORS_PER_USER }, (_, i) => ({
        userId: alice.user.id,
        name: `site ${i}`,
        url: `https://example.com/${i}`,
      })),
    });
    const res = await createMonitor(alice, { url: 'https://example.com/one-too-many' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MONITOR_LIMIT_REACHED');

    // Other users are unaffected.
    expect((await createMonitor(bob, { url: 'https://example.com' })).status).toBe(201);
  });

  it('holds under concurrent creates', async () => {
    await prisma.monitor.createMany({
      data: Array.from({ length: env.MAX_MONITORS_PER_USER - 1 }, (_, i) => ({
        userId: alice.user.id,
        name: `site ${i}`,
        url: `https://example.com/${i}`,
      })),
    });
    const results = await Promise.all(
      [1, 2, 3].map((n) => createMonitor(alice, { url: `https://example.com/race-${n}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.monitor.count({ where: { userId: alice.user.id } })).toBe(
      env.MAX_MONITORS_PER_USER,
    );
  });
});

describe('IDOR protection', () => {
  it("user A gets 404 for every endpoint on user B's monitor", async () => {
    const { body } = await createMonitor(bob, { url: 'https://example.com' });
    const id = body.monitor.id as string;

    const responses = await Promise.all([
      request(app).get(`/api/monitors/${id}`).set(as(alice)),
      request(app).patch(`/api/monitors/${id}`).set(as(alice)).send({ name: 'pwned' }),
      request(app).delete(`/api/monitors/${id}`).set(as(alice)),
      request(app).get(`/api/monitors/${id}/checks`).set(as(alice)),
      request(app).get(`/api/monitors/${id}/incidents`).set(as(alice)),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MONITOR_NOT_FOUND');
    }

    const untouched = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(untouched.name).toBe('example.com');
  });
});

describe('checks, uptime and incidents', () => {
  async function monitorWithChecks() {
    const { body } = await createMonitor(alice, { url: 'https://example.com' });
    const id = body.monitor.id as string;
    const now = Date.now();
    const minutes = (n: number) => new Date(now - n * 60_000);
    // Last 24h: 3 up + 1 down => 75%. 3 days ago: 1 down => 7d = 3/5 = 60%.
    // 20 days ago: 5 up => 30d = 8/10 = 80%.
    await prisma.check.createMany({
      data: [
        { monitorId: id, checkedAt: minutes(10), isUp: true, statusCode: 200, responseTimeMs: 100 },
        { monitorId: id, checkedAt: minutes(20), isUp: true, statusCode: 200, responseTimeMs: 200 },
        { monitorId: id, checkedAt: minutes(30), isUp: true, statusCode: 200, responseTimeMs: 300 },
        { monitorId: id, checkedAt: minutes(40), isUp: false, statusCode: 500, error: 'HTTP 500' },
        { monitorId: id, checkedAt: minutes(3 * 24 * 60), isUp: false, error: 'timeout' },
        ...Array.from({ length: 5 }, () => ({
          monitorId: id,
          checkedAt: minutes(20 * 24 * 60),
          isUp: true,
          statusCode: 200,
          responseTimeMs: 50,
        })),
        // Older than 30 days: ignored.
        { monitorId: id, checkedAt: minutes(40 * 24 * 60), isUp: false, error: 'old' },
      ],
    });
    return id;
  }

  it('computes uptime 24h/7d/30d and avg response with SQL aggregates', async () => {
    const id = await monitorWithChecks();
    const res = await request(app).get(`/api/monitors/${id}`).set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.monitor.stats).toEqual({
      uptime24h: 75,
      uptime7d: 60,
      uptime30d: 80,
      avgResponseMs24h: 200,
      checks24h: 4,
    });
    expect(res.body.monitor.lastCheck).toMatchObject({ isUp: true, responseTimeMs: 100 });

    const list = await request(app).get('/api/monitors').set(as(alice));
    expect(list.body.monitors[0].uptime24h).toBe(75);
    // Status strip: every check (11 < 30), oldest first.
    const recent = list.body.monitors[0].recentChecks as { checkedAt: string; isUp: boolean }[];
    expect(recent).toHaveLength(11);
    expect(recent.at(-1)).toMatchObject({ isUp: true });
    expect(new Date(recent[0]!.checkedAt) < new Date(recent.at(-1)!.checkedAt)).toBe(true);
  });

  it('paginates checks newest-first with an opaque cursor', async () => {
    const id = await monitorWithChecks();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await request(app)
        .get(`/api/monitors/${id}/checks`)
        .query({ limit: 4, ...(cursor ? { cursor } : {}) })
        .set(as(alice));
      expect(res.status).toBe(200);
      seen.push(...res.body.checks.map((c: { id: string }) => c.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3); // 11 checks / 4 per page
    expect(new Set(seen).size).toBe(11);
    const all = await prisma.check.findMany({
      where: { monitorId: id },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    });
    expect(seen).toEqual(all.map((c) => c.id));
  });

  it('filters checks by `since` and rejects a bad cursor', async () => {
    const id = await monitorWithChecks();
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const res = await request(app)
      .get(`/api/monitors/${id}/checks`)
      .query({ since })
      .set(as(alice));
    expect(res.body.checks).toHaveLength(4);

    const bad = await request(app)
      .get(`/api/monitors/${id}/checks`)
      .query({ cursor: 'garbage' })
      .set(as(alice));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });

  it('lists incidents newest first', async () => {
    const id = await monitorWithChecks();
    await prisma.incident.createMany({
      data: [
        {
          monitorId: id,
          startedAt: new Date(Date.now() - 3_600_000),
          resolvedAt: new Date(),
          cause: 'old',
        },
        { monitorId: id, cause: 'HTTP 500' },
      ],
    });
    const res = await request(app).get(`/api/monitors/${id}/incidents`).set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.incidents.map((i: { cause: string }) => i.cause)).toEqual(['HTTP 500', 'old']);
  });
});
