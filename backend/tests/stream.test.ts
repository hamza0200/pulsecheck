/**
 * Live updates over SSE and stream tickets (integration against a real listening HTTP server).
 * - Getting a ticket requires authentication
 * - Tickets are single-use and expire after 60 seconds
 * - A missing, unknown or reused ticket is rejected
 * - The stream sends SSE headers, a ready event, and only the owner's events (owner id stripped)
 * - Event listeners are removed when the client disconnects (no leak)
 * - formatSse output format
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { type MonitorCheckedEvent, events } from '../src/lib/events.js';
import { formatSse } from '../src/modules/stream/stream.service.js';
import { TICKET_TTL_MS, consumeTicket, issueTicket } from '../src/modules/stream/tickets.js';
import { type TestSession, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

let server: Server;
let baseUrl: string;
let alice: TestSession;
let bob: TestSession;

beforeAll(async () => {
  // A real listening server: SSE is a long-lived response, best tested with real fetch.
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
  await resetDb();
  const app = createApp();
  alice = await signupUser(app, 'alice@example.com');
  bob = await signupUser(app, 'bob@example.com');
});

async function getTicket(session: TestSession): Promise<string> {
  const res = await fetch(`${baseUrl}/api/stream/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ticket: string; expiresInSeconds: number };
  expect(body.expiresInSeconds).toBe(60);
  return body.ticket;
}

/** Opens a stream and returns helpers to read events from it. */
async function openStream(ticket: string) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/stream?ticket=${ticket}`, { signal: controller.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  return {
    res,
    /** Reads until the accumulated text contains `needle` (or times out). */
    async readUntil(needle: string, timeoutMs = 2000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!buffer.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${needle}`);
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
      }
      return buffer;
    },
    close: () => controller.abort(),
  };
}

function checkedEvent(userId: string, name: string): MonitorCheckedEvent {
  return {
    userId,
    monitorId: crypto.randomUUID(),
    name,
    url: `https://${name}`,
    status: 'UP',
    checkedAt: new Date(),
    isUp: true,
    statusCode: 200,
    responseTimeMs: 120,
    error: null,
    consecutiveFailures: 0,
  };
}

describe('stream tickets', () => {
  it('requires authentication to get a ticket', async () => {
    const res = await fetch(`${baseUrl}/api/stream/ticket`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('are single-use and expire after 60 seconds', () => {
    const now = Date.now();
    const ticket = issueTicket('user-1', now);
    expect(consumeTicket(ticket, now + 1000)).toBe('user-1');
    expect(consumeTicket(ticket, now + 1000)).toBeNull();

    const late = issueTicket('user-1', now);
    expect(consumeTicket(late, now + TICKET_TTL_MS + 1)).toBeNull();
  });

  it('rejects a missing, unknown or reused ticket', async () => {
    expect((await fetch(`${baseUrl}/api/stream`)).status).toBe(400);
    const unknown = await fetch(`${baseUrl}/api/stream?ticket=nope`);
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      'INVALID_TICKET',
    );

    const ticket = await getTicket(alice);
    const first = await openStream(ticket);
    expect(first.res.status).toBe(200);
    first.close();
    expect((await fetch(`${baseUrl}/api/stream?ticket=${ticket}`)).status).toBe(401);
  });
});

describe('GET /api/stream', () => {
  it('sends SSE headers, a ready event, and only the owner’s events', async () => {
    const stream = await openStream(await getTicket(alice));
    expect(stream.res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(stream.res.headers.get('cache-control')).toBe('no-cache, no-transform');
    await stream.readUntil('event: ready');

    events.emit('monitor.checked', checkedEvent(bob.user.id, 'bobs-site.com'));
    events.emit('monitor.checked', checkedEvent(alice.user.id, 'alices-site.com'));
    const text = await stream.readUntil('alices-site.com');
    stream.close();

    expect(text).toContain('event: monitor.checked');
    expect(text).not.toContain('bobs-site.com');
    expect(text).not.toContain(alice.user.id); // owner ids are stripped
  });

  it('removes its event listeners when the client disconnects', async () => {
    const baseline = events.listenerCount('monitor.checked');
    const stream = await openStream(await getTicket(alice));
    await stream.readUntil('event: ready');
    expect(events.listenerCount('monitor.checked')).toBe(baseline + 1);

    stream.close();
    await vi.waitFor(() => expect(events.listenerCount('monitor.checked')).toBe(baseline));
  });
});

describe('formatSse', () => {
  it('formats a named event with JSON data and a blank-line terminator', () => {
    expect(formatSse('ping', { a: 1 })).toBe('event: ping\ndata: {"a":1}\n\n');
  });
});
