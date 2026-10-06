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

// Admins may see every monitor's URL and status, and who owns it (read-only).
export const adminMonitorSelect = {
  id: true,
  name: true,
  url: true,
  intervalMinutes: true,
  isPaused: true,
  currentStatus: true,
  lastCheckedAt: true,
  sslExpiresAt: true,
  createdAt: true,
  user: { select: { id: true, email: true, isDisabled: true } },
} satisfies Prisma.MonitorSelect;

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

  /** Every user's monitors, newest first, keyset-paginated on (createdAt, id). */
  listMonitors(opts: {
    limit: number;
    search?: string;
    userId?: string;
    status?: 'UP' | 'DOWN' | 'UNKNOWN' | 'PAUSED';
    after?: { createdAt: Date; id: string };
  }) {
    const filters: Prisma.MonitorWhereInput[] = [];
    if (opts.userId) filters.push({ userId: opts.userId });
    if (opts.status === 'PAUSED') filters.push({ isPaused: true });
    else if (opts.status) filters.push({ currentStatus: opts.status, isPaused: false });
    if (opts.search) {
      const contains = { contains: opts.search, mode: 'insensitive' } as const;
      filters.push({ OR: [{ url: contains }, { name: contains }, { user: { email: contains } }] });
    }
    if (opts.after) {
      filters.push({
        OR: [
          { createdAt: { lt: opts.after.createdAt } },
          { createdAt: opts.after.createdAt, id: { lt: opts.after.id } },
        ],
      });
    }
    return prisma.monitor.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      select: adminMonitorSelect,
    });
  },

  findUser(id: string) {
    return prisma.user.findUnique({ where: { id }, select: adminUserSelect });
  },
};
