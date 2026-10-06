import { prisma } from '../../lib/prisma.js';
import type { Prisma, Role } from '../../generated/prisma/client.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const publicUserSelect = {
  id: true,
  email: true,
  role: true,
  alertsEnabled: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export const userRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  create(data: { email: string; passwordHash: string; role?: Role }) {
    return prisma.user.create({ data });
  },

  updatePassword(id: string, passwordHash: string, db: Db = prisma) {
    return db.user.update({ where: { id }, data: { passwordHash } });
  },
};

export const refreshTokenRepository = {
  create(
    data: { id: string; userId: string; familyId: string; tokenHash: string; expiresAt: Date },
    db: Db = prisma,
  ) {
    return db.refreshToken.create({ data });
  },

  findById(id: string) {
    return prisma.refreshToken.findUnique({ where: { id } });
  },

  /**
   * Revokes one token only if it is still active. Returns true if this call revoked it.
   * The conditional update is atomic, so two concurrent refreshes can't both succeed.
   */
  async revokeIfActive(id: string, db: Db = prisma): Promise<boolean> {
    const result = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  },

  revokeFamily(familyId: string) {
    return prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllForUser(userId: string, db: Db = prisma, exceptFamilyId?: string) {
    return db.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  },
};
