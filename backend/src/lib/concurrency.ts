/**
 * Runs async tasks with at most `limit` in flight at once and returns every outcome in
 * the original order, like Promise.allSettled. One rejected task never stops the others.
 *
 * Why not Promise.all(tasks.map(t => t()))? That starts everything at once: 500 monitors
 * would mean 500 simultaneous sockets. Why not p-limit? This is ~15 lines and shows how
 * it works.
 */
export async function runWithLimit<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be >= 1');
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  // [Node concept: concurrency] Each worker loops: take the next index, run it, repeat.
  // `next++` needs no lock: JavaScript runs on one thread, and a worker only yields at
  // `await`, never between reading and incrementing `next`. So two workers can never take
  // the same index.
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]!() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers); // workers never reject: each catches its own task errors
  return results;
}
