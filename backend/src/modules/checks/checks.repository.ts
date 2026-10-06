import { prisma } from '../../lib/prisma.js';

export const checkSelect = {
  id: true,
  checkedAt: true,
  isUp: true,
  statusCode: true,
  responseTimeMs: true,
  error: true,
} as const;

export const checksRepository = {
  /**
   * Keyset ("cursor") pagination, newest first. Each page asks for rows strictly older
   * than the last row of the previous page, using (checkedAt, id) as a unique sort key.
   * Unlike OFFSET, the cost doesn't grow with page depth, and rows inserted meanwhile
   * don't shift pages.
   */
  listPage(
    monitorId: string,
    opts: { limit: number; after?: { checkedAt: Date; id: string }; since?: Date },
  ) {
    return prisma.check.findMany({
      where: {
        monitorId,
        ...(opts.since ? { checkedAt: { gt: opts.since } } : {}),
        ...(opts.after
          ? {
              OR: [
                { checkedAt: { lt: opts.after.checkedAt } },
                { checkedAt: opts.after.checkedAt, id: { lt: opts.after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1, // one extra row tells us whether there is a next page
      select: checkSelect,
    });
  },
};

export type CheckRow = Awaited<ReturnType<typeof checksRepository.listPage>>[number];

/**
 * Yields every check of a monitor, oldest first, fetching `batchSize` rows per query.
 *
 * [Node concept: streams] An async generator is a pull-based source: the next batch is only
 * fetched when the consumer asks for more. Wrapped in Readable.from() and piped into a
 * response, a slow client automatically slows down the database reads (backpressure),
 * and memory holds at most one batch however many rows there are.
 */
export async function* iterateChecks(monitorId: string, batchSize = 1000) {
  let after: { checkedAt: Date; id: string } | undefined;
  for (;;) {
    const batch = await prisma.check.findMany({
      where: {
        monitorId,
        ...(after
          ? {
              OR: [
                { checkedAt: { gt: after.checkedAt } },
                { checkedAt: after.checkedAt, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: checkSelect,
    });
    yield* batch;
    if (batch.length < batchSize) return;
    after = batch[batch.length - 1];
  }
}

export interface DueMonitor {
  id: string;
  userId: string;
  name: string;
  url: string;
  timeoutMs: number;
  sslCheckedAt: Date | null;
}

/** The scheduler ticks every 60s; this slack keeps a 10-minute monitor from slipping to 11. */
const DUE_SLACK_SECONDS = 30;

export const dueMonitorsRepository = {
  /**
   * Monitors that are not paused, whose owner is not disabled, and that were never
   * checked or were last checked at least `interval_minutes` ago. Least recently checked
   * first, so nothing starves.
   */
  findDue(): Promise<DueMonitor[]> {
    return prisma.$queryRaw<DueMonitor[]>`
      SELECT m.id, m.user_id AS "userId", m.name, m.url, m.timeout_ms AS "timeoutMs",
             m.ssl_checked_at AS "sslCheckedAt"
      FROM monitors m
      JOIN users u ON u.id = m.user_id
      WHERE NOT m.is_paused
        AND NOT u.is_disabled
        AND (
          m.last_checked_at IS NULL
          OR m.last_checked_at <= now()
               - make_interval(mins => m.interval_minutes)
               + make_interval(secs => ${DUE_SLACK_SECONDS})
        )
      ORDER BY m.last_checked_at ASC NULLS FIRST`;
  },

  findOne(id: string): Promise<DueMonitor | null> {
    return prisma.monitor.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        name: true,
        url: true,
        timeoutMs: true,
        sslCheckedAt: true,
      },
    });
  },
};
