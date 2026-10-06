import type { Request, Response } from 'express';
import { type AppEvents, events } from '../../lib/events.js';

export const HEARTBEAT_MS = 25_000;
export const MAX_CONNECTIONS = 200;
export const MAX_CONNECTIONS_PER_USER = 10;

/** Events forwarded to the browser, and the listeners each connection adds. */
const STREAMED_EVENTS = ['monitor.checked', 'monitor.down', 'monitor.recovered'] as const;
type StreamedEvent = (typeof STREAMED_EVENTS)[number];

// [Node concept: EventEmitter] Every open stream adds one listener per streamed event to
// the shared bus. Node warns ("possible EventEmitter memory leak") above 10 listeners per
// event by default. We raise the cap to what we deliberately allow, so the warning still
// fires if listeners ever leak past it, e.g. if a close handler were missing.
events.setMaxListeners(MAX_CONNECTIONS + 10);

interface Connection {
  userId: string;
  res: Response;
  close: () => void;
}

const connections = new Set<Connection>();

export function connectionCount(userId?: string): number {
  if (!userId) return connections.size;
  let count = 0;
  for (const c of connections) if (c.userId === userId) count++;
  return count;
}

export function canOpenStream(userId: string): boolean {
  return connections.size < MAX_CONNECTIONS && connectionCount(userId) < MAX_CONNECTIONS_PER_USER;
}

/** Formats one Server-Sent Event: named event + JSON data, terminated by a blank line. */
export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Strips the owner id before data leaves the server. */
function toClientPayload<E extends StreamedEvent>(payload: AppEvents[E][0]) {
  const { userId: _userId, ...rest } = payload;
  return rest;
}

/**
 * Turns an HTTP response into a long-lived event stream for one user. Only that user's
 * events are written. Everything is cleaned up when the client disconnects.
 */
export function openStream(userId: string, req: Request, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // tell Nginx-style proxies not to buffer
  res.flushHeaders();

  // `retry` tells EventSource how long to wait before reconnecting after a drop.
  res.write('retry: 5000\n\n');
  res.write(formatSse('ready', { connectedAt: new Date().toISOString() }));

  const listeners = STREAMED_EVENTS.map((name) => {
    const listener = (payload: AppEvents[typeof name][0]) => {
      if (payload.userId !== userId) return; // tenant isolation
      res.write(formatSse(name, toClientPayload(payload)));
    };
    events.on(name, listener);
    return [name, listener] as const;
  });

  // [Node concept: timers] Comment lines (": ...") are ignored by EventSource but keep
  // proxies and load balancers from closing an idle connection. unref() so open streams
  // never keep a shutting-down process alive.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS).unref();

  let closed = false;
  const connection: Connection = {
    userId,
    res,
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      // [Node concept: EventEmitter] The essential leak fix: without removing these, every
      // closed tab would leave listeners (and its whole response object) alive forever.
      for (const [name, listener] of listeners) events.off(name, listener as never);
      connections.delete(connection);
    },
  };
  connections.add(connection);

  // [Node concept: SSE] The request never "finishes" normally; it ends when the client
  // goes away (tab closed, network drop, EventSource reconnect). 'close' fires on the
  // request when its underlying connection closes, whatever the reason.
  req.on('close', connection.close);
}

/** For graceful shutdown: end every open stream so server.close() can finish. */
export function closeAllStreams(): void {
  for (const connection of [...connections]) {
    connection.close();
    connection.res.end();
  }
}
