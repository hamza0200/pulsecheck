import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { runWithLimit } from '../src/lib/concurrency.js';

describe('runWithLimit', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
    });
    await runWithLimit(tasks, 3);
    expect(maxActive).toBe(3);
  });

  it('preserves input order even when tasks finish out of order', async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await runWithLimit(
      delays.map((ms, i) => async () => {
        await sleep(ms);
        return i;
      }),
      2,
    );
    expect(results).toEqual(delays.map((_, i) => ({ status: 'fulfilled', value: i })));
  });

  it('records rejections without stopping the other tasks (allSettled semantics)', async () => {
    const boom = new Error('boom');
    const results = await runWithLimit(
      [async () => 1, async () => Promise.reject(boom), async () => 3, async () => 4],
      2,
    );
    expect(results).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: boom },
      { status: 'fulfilled', value: 3 },
      { status: 'fulfilled', value: 4 },
    ]);
  });

  it('handles synchronous throws, empty input, and a limit larger than the task count', async () => {
    const results = await runWithLimit(
      [
        () => {
          throw new Error('sync');
        },
      ],
      10,
    );
    expect(results[0]?.status).toBe('rejected');
    expect(await runWithLimit([], 5)).toEqual([]);
  });

  it('rejects an invalid limit', async () => {
    await expect(runWithLimit([], 0)).rejects.toThrow(RangeError);
  });
});
