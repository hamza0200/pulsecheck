/**
 * retry + backoffDelay (unit).
 * - Returns the first success without retrying
 * - Retries up to `retries` times and then succeeds
 * - Gives up after `retries` and rethrows the last error
 * - Does not retry errors that shouldRetry rejects
 * - Reports each retry with its delay (onRetry)
 * - Backoff grows exponentially, is capped, and is randomised (full jitter)
 */
import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, retry } from '../src/lib/retry.js';

describe('retry', () => {
  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retry(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to `retries` times, then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('third time lucky');
    await expect(retry(fn, { retries: 2, baseDelayMs: 1 })).resolves.toBe('third time lucky');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1, 2]);
  });

  it('gives up after `retries` and rethrows the last error', async () => {
    const fn = vi.fn().mockImplementation(async (attempt: number) => {
      throw new Error(`attempt ${attempt}`);
    });
    await expect(retry(fn, { retries: 1, baseDelayMs: 1 })).rejects.toThrow('attempt 1');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry errors that shouldRetry rejects', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(
      retry(fn, { retries: 5, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports each retry with its delay', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    await retry(fn, { retries: 1, baseDelayMs: 10, onRetry, random: () => 0.5 });
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 5);
  });
});

describe('backoffDelay (full jitter)', () => {
  it('grows exponentially and is capped', () => {
    const max = () => 1; // worst case of the random factor
    expect(backoffDelay(0, 100, 10_000, max)).toBe(100);
    expect(backoffDelay(1, 100, 10_000, max)).toBe(200);
    expect(backoffDelay(3, 100, 10_000, max)).toBe(800);
    expect(backoffDelay(20, 100, 10_000, max)).toBe(10_000);
  });

  it('is randomised between 0 and the ceiling', () => {
    expect(backoffDelay(2, 100, 10_000, () => 0)).toBe(0);
    for (let i = 0; i < 50; i++) {
      const delay = backoffDelay(2, 100);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });
});
