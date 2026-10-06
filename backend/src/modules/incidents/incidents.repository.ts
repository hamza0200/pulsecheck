import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const incidentSelect = {
  id: true,
  startedAt: true,
  resolvedAt: true,
  cause: true,
} as const;

export const incidentsRepository = {
  listForMonitor(monitorId: string, limit: number) {
    return prisma.incident.findMany({
      where: { monitorId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: incidentSelect,
    });
  },

  findOpen(monitorId: string, db: Db = prisma) {
    return db.incident.findFirst({
      where: { monitorId, resolvedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  },

  open(monitorId: string, cause: string, db: Db = prisma) {
    return db.incident.create({ data: { monitorId, cause } });
  },

  resolveOpen(monitorId: string, db: Db = prisma) {
    return db.incident.updateMany({
      where: { monitorId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  },
};
