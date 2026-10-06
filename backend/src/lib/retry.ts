import { setTimeout as sleep } from 'node:timers/promises';

export interface RetryOptions {
  /** Retries after the first attempt (1 => at most 2 attempts). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Return false for errors that won't fix themselves (e.g. validation). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  random?: () => number;
}

/**
 * "Full jitter" exponential backoff: a random delay between 0 and base * 2^attempt
 * (capped). The exponent backs off from a struggling server; the randomness stops many
 * clients that failed at the same moment from retrying in lockstep (a thundering herd).
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs = 30_000,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

// [Node concept: retries] Retry transient failures (network blips, timeouts) a bounded
// number of times with growing, randomised waits; give up and surface the last error.
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { retries, baseDelayMs, maxDelayMs, shouldRetry = () => true, onRetry, random } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      onRetry?.(error, attempt + 1, delayMs);
      // [Node concept: timers] node:timers/promises gives an awaitable setTimeout.
      await sleep(delayMs);
    }
  }
}
