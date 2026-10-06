/**
 * Check runner, scheduler pipeline and check-now (integration, test DB; fetch, DNS and TLS mocked).
 * - Full state machine through the runner: UP -> 1 failure stays UP -> 2 failures DOWN + incident
 *   -> success resolves it, with the right events emitted
 * - SSL expiry is checked at most once a day and warns when fewer than 14 days remain
 * - runChecks only checks due monitors (skips paused, fresh and disabled-owner monitors) and stores
 *   a run summary; an idle tick (nothing due) keeps the previous summary
 * - Overlap guard: a second trigger during a run returns null
 * - One failing site never stops the others
 * - POST /check-now: returns the result, 404 for another user's monitor, rate limited to once per minute
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { type AppEvents, events } from '../src/lib/events.js';
import { prisma } from '../src/lib/prisma.js';
import { checkMonitorById, getLastRunSummary, runChecks } from '../src/modules/checks/runner.js';
import { type TestSession, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import type * as SslModule from '../src/modules/checks/ssl.js';
import { mockFetch, ok, status } from './helpers/fetch.js';

vi.mock('node:dns/promises', async () => (await import('./helpers/dns.js')).dnsMockModule);

// Never open real TLS connections in tests.
const sslExpiry = vi.hoisted(() => ({ date: new Date(Date.now() + 90 * 86_400_000) }));
vi.mock('../src/modules/checks/ssl.js', async (importOriginal) => {
  const original = await importOriginal<typeof SslModule>();
  return { ...original, getCertificateExpiry: vi.fn(async () => sslExpiry.date) };
});

const app = createApp();
let owner: TestSession;

/** Records every event of the given names while a test runs. */
function captureEvents(...names: (keyof AppEvents)[]) {
  const seen: { name: string; payload: unknown }[] = [];
  const listeners = names.map((name) => {
    const listener = (payload: unknown) => seen.push({ name, payload });
    events.on(name, listener as never);
    return () => events.off(name, listener as never);
  });
  return { seen, stop: () => listeners.forEach((off) => off()) };
}

async function createMonitor(url: string, data: Record<string, unknown> = {}) {
  return prisma.monitor.create({
    data: { userId: owner.user.id, name: new URL(url).hostname, url, ...data },
  });
}

beforeEach(async () => {
  await resetDb();
  owner = await signupUser(app, 'owner@example.com');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('monitor state machine through the runner', () => {
  it('UP -> 1 failure stays UP -> 2 failures DOWN + incident -> success resolves', async () => {
    const monitor = await createMonitor('https://example.com', { currentStatus: 'UP' });
    const captured = captureEvents('monitor.down', 'monitor.recovered', 'monitor.checked');
    let nextStatus = 500;
    mockFetch(() => status(nextStatus));

    await checkMonitorById(monitor.id); // failure 1
    let row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(row).toMatchObject({ currentStatus: 'UP', consecutiveFailures: 1 });
    expect(await prisma.incident.count()).toBe(0);

    await checkMonitorById(monitor.id); // failure 2 -> DOWN
    row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(row).toMatchObject({ currentStatus: 'DOWN', consecutiveFailures: 2 });
    const incident = await prisma.incident.findFirstOrThrow({ where: { monitorId: monitor.id } });
    expect(incident).toMatchObject({ cause: 'HTTP 500', resolvedAt: null });

    await checkMonitorById(monitor.id); // failure 3: still one incident, no new event
    expect(await prisma.incident.count()).toBe(1);

    nextStatus = 200;
    await checkMonitorById(monitor.id); // recovery
    row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(row).toMatchObject({ currentStatus: 'UP', consecutiveFailures: 0 });
    const resolved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    captured.stop();
    const names = captured.seen.map((e) => e.name);
    expect(names.filter((n) => n === 'monitor.checked')).toHaveLength(4);
    expect(names.filter((n) => n === 'monitor.down')).toHaveLength(1);
    expect(names.filter((n) => n === 'monitor.recovered')).toHaveLength(1);
    const down = captured.seen.find((e) => e.name === 'monitor.down')!.payload;
    expect(down).toMatchObject({ userId: owner.user.id, monitorId: monitor.id, cause: 'HTTP 500' });
    const recovered = captured.seen.find((e) => e.name === 'monitor.recovered')!.payload;
    expect(recovered).toMatchObject({ downSince: incident.startedAt });

    expect(await prisma.check.count({ where: { monitorId: monitor.id } })).toBe(4);
  });

  it('checks SSL once per day and warns when fewer than 14 days remain', async () => {
    sslExpiry.date = new Date(Date.now() + 5 * 86_400_000);
    const monitor = await createMonitor('https://example.com');
    const captured = captureEvents('monitor.sslExpiring');
    mockFetch(() => ok());

    await checkMonitorById(monitor.id);
    await checkMonitorById(monitor.id); // same day: SSL not re-checked
    captured.stop();

    const row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(row.sslExpiresAt?.getTime()).toBe(sslExpiry.date.getTime());
    expect(row.sslCheckedAt).toBeInstanceOf(Date);
    expect(captured.seen).toHaveLength(1);
    expect(captured.seen[0]!.payload).toMatchObject({ daysLeft: 4, userId: owner.user.id });
    sslExpiry.date = new Date(Date.now() + 90 * 86_400_000);
  });
});

describe('runChecks', () => {
  it('only checks due monitors of active owners, and records a summary', async () => {
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
    const due = await createMonitor('https://example.com/never-checked');
    const stale = await createMonitor('https://example.com/stale', {
      lastCheckedAt: minutesAgo(11),
      currentStatus: 'UP',
    });
    await createMonitor('https://example.com/fresh', { lastCheckedAt: minutesAgo(2) });
    await createMonitor('https://example.com/paused', { isPaused: true });
    const other = await signupUser(app, 'disabled@example.com');
    await prisma.user.update({ where: { id: other.user.id }, data: { isDisabled: true } });
    await prisma.monitor.create({
      data: { userId: other.user.id, name: 'x', url: 'https://example.com/disabled-owner' },
    });

    const fetchSpy = mockFetch((url) => (url.endsWith('/stale') ? status(503) : ok()));
    const summary = await runChecks();

    expect(summary).toMatchObject({ checked: 2, up: 1, down: 1, errors: 0 });
    expect(new Set(fetchSpy.mock.calls.map(([u]) => u))).toEqual(
      new Set(['https://example.com/never-checked', 'https://example.com/stale']),
    );
    expect(getLastRunSummary()).toEqual(summary);
    // A later tick with nothing due doesn't overwrite the useful summary.
    const idle = await runChecks();
    expect(idle).toMatchObject({ checked: 0 });
    expect(getLastRunSummary()).toEqual(summary);
    const checked = await prisma.monitor.findMany({
      where: { id: { in: [due.id, stale.id] } },
    });
    expect(checked.every((m) => m.lastCheckedAt !== null)).toBe(true);
  });

  it('overlap guard: a second trigger during a run returns null immediately', async () => {
    await createMonitor('https://example.com');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockFetch(async () => {
      await gate;
      return ok();
    });

    const first = runChecks();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(await runChecks()).toBeNull();
    release();
    expect(await first).toMatchObject({ checked: 1 });
  });

  it('one failing site never stops the others', async () => {
    for (const n of [1, 2, 3, 4, 5, 6]) await createMonitor(`https://example.com/${n}`);
    mockFetch((url) => {
      if (url.endsWith('/3')) throw new TypeError('fetch failed');
      return ok();
    });
    const summary = await runChecks();
    expect(summary).toMatchObject({ checked: 6, up: 5, down: 1, errors: 0 });
  });
});

describe('POST /api/monitors/:id/check-now', () => {
  const as = (s: TestSession) => ({ Authorization: `Bearer ${s.accessToken}` });

  it('runs a check immediately and returns the result and updated monitor', async () => {
    const monitor = await createMonitor('https://example.com', { isPaused: true });
    mockFetch(() => ok());
    const res = await request(app).post(`/api/monitors/${monitor.id}/check-now`).set(as(owner));
    expect(res.status).toBe(200);
    expect(res.body.check).toMatchObject({ isUp: true, statusCode: 200 });
    expect(res.body.monitor).toMatchObject({ currentStatus: 'UP', isPaused: true });
    expect(res.body.monitor.stats.checks24h).toBe(1);
  });

  it("returns 404 for someone else's monitor", async () => {
    const monitor = await createMonitor('https://example.com');
    const intruder = await signupUser(app, 'intruder@example.com');
    const fetchSpy = mockFetch(() => ok());
    const res = await request(app).post(`/api/monitors/${monitor.id}/check-now`).set(as(intruder));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is rate limited to once per minute per monitor', async () => {
    process.env.RATE_LIMIT_IN_TESTS = 'true';
    try {
      const monitor = await createMonitor('https://example.com');
      mockFetch(() => ok());
      const url = `/api/monitors/${monitor.id}/check-now`;
      expect((await request(app).post(url).set(as(owner))).status).toBe(200);
      const second = await request(app).post(url).set(as(owner));
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('RATE_LIMITED');
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});
