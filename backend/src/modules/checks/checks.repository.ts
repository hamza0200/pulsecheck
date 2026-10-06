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
