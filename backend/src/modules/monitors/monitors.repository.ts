import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';

type Db = Prisma.TransactionClient | typeof prisma;

// Multi-tenancy rule: every query in this file filters by userId as well as id. A monitor
// that belongs to someone else is indistinguishable from one that doesn't exist (IDOR
// prevention), so callers turn "not found" into a 404 either way.

export const monitorSelect = {
  id: true,
  name: true,
  url: true,
  intervalMinutes: true,
  timeoutMs: true,
  isPaused: true,
  currentStatus: true,
  consecutiveFailures: true,
  lastCheckedAt: true,
  sslExpiresAt: true,
  sslCheckedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MonitorSelect;

export type MonitorDto = Prisma.MonitorGetPayload<{ select: typeof monitorSelect }>;

export interface LatestCheck {
  monitorId: string;
  checkedAt: Date;
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

export interface UptimeStats {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  avgResponseMs24h: number | null;
  checks24h: number;
}

export const monitorRepository = {
  listForUser(userId: string) {
    return prisma.monitor.findMany({
      where: { userId },
      select: monitorSelect,
      orderBy: { createdAt: 'asc' },
    });
  },

  findOwned(id: string, userId: string) {
    return prisma.monitor.findFirst({ where: { id, userId }, select: monitorSelect });
  },

  countForUser(userId: string, db: Db = prisma) {
    return db.monitor.count({ where: { userId } });
  },

  /**
   * Locks the user's row until the transaction ends, so concurrent "create monitor"
   * requests from the same user run one at a time and can't overshoot the limit.
   */
  async lockUser(userId: string, db: Db) {
    await db.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  },

  create(data: Prisma.MonitorUncheckedCreateInput, db: Db = prisma) {
    return db.monitor.create({ data, select: monitorSelect });
  },

  async updateOwned(
    id: string,
    userId: string,
    data: Prisma.MonitorUpdateManyMutationInput,
    db: Db = prisma,
  ) {
    const { count } = await db.monitor.updateMany({ where: { id, userId }, data });
    return count === 1;
  },

  async deleteOwned(id: string, userId: string) {
    const { count } = await prisma.monitor.deleteMany({ where: { id, userId } });
    return count === 1;
  },

  /**
   * Latest check per monitor. LATERAL + LIMIT 1 walks the (monitor_id, checked_at DESC)
   * index once per monitor instead of scanning every check.
   */
  async latestChecks(monitorIds: string[]): Promise<Map<string, LatestCheck>> {
    if (monitorIds.length === 0) return new Map();
    const rows = await prisma.$queryRaw<LatestCheck[]>`
      SELECT m.id AS "monitorId", c.checked_at AS "checkedAt", c.is_up AS "isUp",
             c.status_code AS "statusCode", c.response_time_ms AS "responseTimeMs", c.error
      FROM unnest(${monitorIds}::uuid[]) AS m(id)
      CROSS JOIN LATERAL (
        SELECT checked_at, is_up, status_code, response_time_ms, error
        FROM checks
        WHERE monitor_id = m.id
        ORDER BY checked_at DESC
        LIMIT 1
      ) c`;
    return new Map(rows.map((row) => [row.monitorId, row]));
  },

  /**
   * The last `perMonitor` checks of each monitor (oldest first), for the dashboard's
   * status strip. One query: LATERAL + LIMIT per monitor, served by the
   * (monitor_id, checked_at DESC) index.
   */
  async recentChecks(
    monitorIds: string[],
    perMonitor = 30,
  ): Promise<Map<string, { checkedAt: Date; isUp: boolean }[]>> {
    const result = new Map<string, { checkedAt: Date; isUp: boolean }[]>();
    if (monitorIds.length === 0) return result;
    const rows = await prisma.$queryRaw<{ monitorId: string; checkedAt: Date; isUp: boolean }[]>`
      SELECT m.id AS "monitorId", c.checked_at AS "checkedAt", c.is_up AS "isUp"
      FROM unnest(${monitorIds}::uuid[]) AS m(id)
      CROSS JOIN LATERAL (
        SELECT checked_at, is_up FROM checks
        WHERE monitor_id = m.id
        ORDER BY checked_at DESC
        LIMIT ${perMonitor}
      ) c
      ORDER BY m.id, c.checked_at ASC`;
    for (const { monitorId, checkedAt, isUp } of rows) {
      const list = result.get(monitorId) ?? [];
      list.push({ checkedAt, isUp });
      result.set(monitorId, list);
    }
    return result;
  },

  /**
   * 24h uptime % for many monitors in one aggregate query. The database does the
   * counting; we never load individual checks into memory.
   */
  async uptime24h(monitorIds: string[]): Promise<Map<string, number | null>> {
    if (monitorIds.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ monitorId: string; uptime: number | null }[]>`
      SELECT monitor_id AS "monitorId",
             ROUND(100.0 * COUNT(*) FILTER (WHERE is_up) / NULLIF(COUNT(*), 0), 2)::float8 AS uptime
      FROM checks
      WHERE monitor_id = ANY(${monitorIds}::uuid[])
        AND checked_at > now() - interval '24 hours'
      GROUP BY monitor_id`;
    return new Map(rows.map((row) => [row.monitorId, row.uptime]));
  },

  /** Uptime over three windows plus average response time, in a single pass. */
  async uptimeStats(monitorId: string): Promise<UptimeStats> {
    const [row] = await prisma.$queryRaw<UptimeStats[]>`
      SELECT
        ROUND(100.0 * COUNT(*) FILTER (WHERE is_up AND checked_at > now() - interval '24 hours')
          / NULLIF(COUNT(*) FILTER (WHERE checked_at > now() - interval '24 hours'), 0), 2)::float8
          AS "uptime24h",
        ROUND(100.0 * COUNT(*) FILTER (WHERE is_up AND checked_at > now() - interval '7 days')
          / NULLIF(COUNT(*) FILTER (WHERE checked_at > now() - interval '7 days'), 0), 2)::float8
          AS "uptime7d",
        ROUND(100.0 * COUNT(*) FILTER (WHERE is_up)
          / NULLIF(COUNT(*), 0), 2)::float8
          AS "uptime30d",
        ROUND(AVG(response_time_ms) FILTER (WHERE is_up AND checked_at > now() - interval '24 hours'))::float8
          AS "avgResponseMs24h",
        (COUNT(*) FILTER (WHERE checked_at > now() - interval '24 hours'))::int AS "checks24h"
      FROM checks
      WHERE monitor_id = ${monitorId}::uuid
        AND checked_at > now() - interval '30 days'`;
    return (
      row ?? {
        uptime24h: null,
        uptime7d: null,
        uptime30d: null,
        avgResponseMs24h: null,
        checks24h: 0,
      }
    );
  },
};
