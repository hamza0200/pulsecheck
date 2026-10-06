import { logger } from '../../lib/logger.js';
import { runChecks } from './runner.js';

export const TICK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 5_000;

let interval: NodeJS.Timeout | undefined;
let startupTimer: NodeJS.Timeout | undefined;

function tick() {
  // A scheduler must never crash the process: log and wait for the next tick.
  runChecks().catch((err: unknown) => logger.error({ err }, 'Check run failed'));
}

/**
 * [Node concept: timers] setInterval fires every 60s; the runner decides which monitors
 * are actually due. unref() means "don't keep the process alive just for this timer", so
 * the process can exit once the HTTP server closes, without waiting for the next tick.
 */
export function startScheduler(): void {
  if (interval) return;
  startupTimer = setTimeout(tick, STARTUP_DELAY_MS).unref();
  interval = setInterval(tick, TICK_INTERVAL_MS).unref();
  logger.info({ everyMs: TICK_INTERVAL_MS }, 'Check scheduler started');
}

/** Stops future ticks. A run in progress keeps going; see waitForCurrentRun. */
export function stopScheduler(): void {
  clearTimeout(startupTimer);
  clearInterval(interval);
  startupTimer = undefined;
  interval = undefined;
}
