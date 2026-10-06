import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

export const RETENTION_DAYS = 30;
export const RETENTION_BATCH_SIZE = 5_000;

/**
 * Deletes checks older than `days`, `batchSize` rows at a time. Returns the number deleted.
 *
 * Why batches? One huge DELETE holds row locks and builds a large transaction for its whole
 * run, competing with the runner's inserts and bloating the write-ahead log. Small batches
 * each commit quickly. Yielding to the event loop between batches keeps the API responsive
 * while a large backlog is cleared.
 */
export async function purgeOldChecks({
  days = RETENTION_DAYS,
  batchSize = RETENTION_BATCH_SIZE,
}: { days?: number; batchSize?: number } = {}): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let total = 0;
  for (;;) {
    // Served by the index on checks(checked_at).
    const deleted = await prisma.$executeRaw`
      DELETE FROM checks
      WHERE id IN (
        SELECT id FROM checks WHERE checked_at < ${cutoff} LIMIT ${batchSize}
      )`;
    total += deleted;
    if (deleted < batchSize) break;
    // [Node concept: event loop] Let pending I/O callbacks run before the next batch.
    await yieldToEventLoop();
  }
  logger.info({ deleted: total, olderThanDays: days }, 'Old checks purged');
  return total;
}
