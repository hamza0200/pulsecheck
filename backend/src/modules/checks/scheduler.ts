import { logger } from '../../lib/logger.js';
import { purgeOldChecks } from './retention.js';
import { runChecks } from './runner.js';

export const TICK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 5_000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_STARTUP_DELAY_MS = 60_000;

const timers: NodeJS.Timeout[] = [];

function tick() {
  // A scheduler must never crash the process: log and wait for the next tick.
  runChecks().catch((err: unknown) => logger.error({ err }, 'Check run failed'));
}

function retention() {
  purgeOldChecks().catch((err: unknown) => logger.error({ err }, 'Retention job failed'));
}

/**
 * [Node concept: timers] setInterval fires every 60s; the runner decides which monitors
 * are actually due. unref() means "don't keep the process alive just for this timer", so
 * the process can exit once the HTTP server closes, without waiting for the next tick.
 * The retention job runs once a minute after startup, then daily.
 */
export function startScheduler(): void {
  if (timers.length > 0) return;
  timers.push(
    setTimeout(tick, STARTUP_DELAY_MS).unref(),
    setInterval(tick, TICK_INTERVAL_MS).unref(),
    setTimeout(retention, RETENTION_STARTUP_DELAY_MS).unref(),
    setInterval(retention, RETENTION_INTERVAL_MS).unref(),
  );
  logger.info({ everyMs: TICK_INTERVAL_MS }, 'Check scheduler started');
}

/** Stops future ticks. A run in progress keeps going; see waitForCurrentRun. */
export function stopScheduler(): void {
  // clearTimeout and clearInterval are interchangeable in Node.
  for (const timer of timers.splice(0)) clearTimeout(timer);
}
