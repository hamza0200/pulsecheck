import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';

// Admin views never select passwordHash or any token columns.
export const adminUserSelect = {
  id: true,
  email: true,
  role: true,
  isDisabled: true,
  createdAt: true,
  _count: { select: { monitors: true } },
} satisfies Prisma.UserSelect;

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;

export function toAdminUser({ _count, ...user }: AdminUserRow) {
  return { ...user, monitorCount: _count.monitors };
}

export const adminRepository = {
  async stats() {
    const [users, disabledUsers, admins, monitorsByStatus, pausedMonitors, checksLast24h] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isDisabled: true } }),
        prisma.user.count({ where: { role: 'ADMIN' } }),
        prisma.monitor.groupBy({ by: ['currentStatus'], _count: { _all: true } }),
        prisma.monitor.count({ where: { isPaused: true } }),
        // Served by the index on checks(checked_at).
        prisma.check.count({ where: { checkedAt: { gt: new Date(Date.now() - 86_400_000) } } }),
      ]);
    const byStatus = Object.fromEntries(
      monitorsByStatus.map((row) => [row.currentStatus, row._count._all]),
    ) as Partial<Record<'UP' | 'DOWN' | 'UNKNOWN', number>>;
    return { users, disabledUsers, admins, byStatus, pausedMonitors, checksLast24h };
  },

  /** Newest users first, keyset-paginated on (createdAt, id), optional email search. */
  listUsers(opts: { limit: number; search?: string; after?: { createdAt: Date; id: string } }) {
    return prisma.user.findMany({
      where: {
        ...(opts.search ? { email: { contains: opts.search, mode: 'insensitive' } } : {}),
        ...(opts.after
          ? {
              OR: [
                { createdAt: { lt: opts.after.createdAt } },
                { createdAt: opts.after.createdAt, id: { lt: opts.after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      select: adminUserSelect,
    });
  },

  findUser(id: string) {
    return prisma.user.findUnique({ where: { id }, select: adminUserSelect });
  },
};
