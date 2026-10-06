import { generateOpaqueToken } from '../../lib/tokens.js';

export const TICKET_TTL_MS = 60_000;

interface TicketEntry {
  userId: string;
  expiresAt: number;
}

// In process memory: fine for a single instance. Several instances would need a shared
// store (Redis with a 60s TTL) or sticky sessions. See docs/decisions.md.
const tickets = new Map<string, TicketEntry>();

function sweepExpired(now: number) {
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
}

/**
 * Issues a random one-time ticket for opening an SSE stream. EventSource can't send an
 * Authorization header, and putting the long-lived access token in a URL would leak it
 * into logs and browser history. A 60-second, single-use ticket is harmless if it leaks.
 */
export function issueTicket(userId: string, now = Date.now()): string {
  sweepExpired(now);
  const ticket = generateOpaqueToken();
  tickets.set(ticket, { userId, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

/** Returns the ticket's userId and deletes it, or null if unknown/expired/already used. */
export function consumeTicket(ticket: string, now = Date.now()): string | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket); // single use, even if expired
  return entry.expiresAt > now ? entry.userId : null;
}
