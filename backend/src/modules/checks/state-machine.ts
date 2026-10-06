import type { MonitorStatus } from '../../generated/prisma/client.js';

/** Consecutive failed checks before a monitor is declared DOWN. */
export const FAILURE_THRESHOLD = 2;

export interface MonitorState {
  status: MonitorStatus;
  consecutiveFailures: number;
}

export type Transition = 'down' | 'recovered' | null;

/**
 * The monitor state machine, as a pure function so it's trivial to test.
 *
 *   success          -> UP, failures reset. DOWN -> UP is a "recovered" transition.
 *   failure          -> failures + 1. Status unchanged until the threshold...
 *   failure #2       -> DOWN, a "down" transition (only if not already DOWN).
 *
 * Requiring 2 failures filters out one-off blips (a dropped packet, a slow deploy), so
 * nobody gets paged for nothing. Recovery needs just 1 success: the site demonstrably
 * answered.
 */
export function nextState(
  previous: MonitorState,
  isUp: boolean,
): MonitorState & { transition: Transition } {
  if (isUp) {
    return {
      status: 'UP',
      consecutiveFailures: 0,
      transition: previous.status === 'DOWN' ? 'recovered' : null,
    };
  }
  const consecutiveFailures = previous.consecutiveFailures + 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD && previous.status !== 'DOWN') {
    return { status: 'DOWN', consecutiveFailures, transition: 'down' };
  }
  return { status: previous.status, consecutiveFailures, transition: null };
}
