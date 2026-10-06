import { prisma } from '../../lib/prisma.js';

export const accountSelect = {
  id: true,
  email: true,
  role: true,
  alertsEnabled: true,
  createdAt: true,
} as const;

export const accountRepository = {
  find(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: accountSelect });
  },

  update(userId: string, data: { alertsEnabled: boolean }) {
    return prisma.user.update({ where: { id: userId }, data, select: accountSelect });
  },

  countAdmins() {
    return prisma.user.count({ where: { role: 'ADMIN', isDisabled: false } });
  },

  /** Monitors, checks, incidents and tokens go with it via ON DELETE CASCADE. */
  delete(userId: string) {
    return prisma.user.delete({ where: { id: userId } });
  },
};
