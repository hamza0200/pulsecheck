/**
 * Retention job (integration, test DB).
 * - Deletes checks older than 30 days and keeps newer ones
 * - Works in batches: a batch size smaller than the backlog still deletes everything
 * - Returns the number of rows deleted (0 when nothing is old)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { purgeOldChecks } from '../src/modules/checks/retention.js';
import { resetDb } from './helpers/db.js';

beforeEach(resetDb);

async function seedChecks() {
  const user = await prisma.user.create({ data: { email: 'r@example.com', passwordHash: 'x' } });
  const monitor = await prisma.monitor.create({
    data: { userId: user.id, name: 'r', url: 'https://example.com' },
  });
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
  await prisma.check.createMany({
    data: [
      ...Array.from({ length: 7 }, (_, i) => ({
        monitorId: monitor.id,
        checkedAt: daysAgo(31 + i),
        isUp: true,
      })),
      { monitorId: monitor.id, checkedAt: daysAgo(29), isUp: true },
      { monitorId: monitor.id, checkedAt: daysAgo(1), isUp: false },
    ],
  });
}

describe('purgeOldChecks', () => {
  it('deletes only checks older than 30 days, in batches', async () => {
    await seedChecks();
    expect(await purgeOldChecks({ batchSize: 3 })).toBe(7);
    expect(await prisma.check.count()).toBe(2);
    expect(await purgeOldChecks({ batchSize: 3 })).toBe(0);
  });
});
