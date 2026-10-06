import type { User } from '../../generated/prisma/client.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { refreshTokenRepository } from '../auth/auth.repository.js';

// Used by scripts/create-admin.ts. Kept separate from the CLI's prompts so it is testable.

export async function createAdminUser(email: string, password: string): Promise<User> {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: 'ADMIN' },
  });
}

/** Promotes an existing user to ADMIN and optionally replaces their password. */
export async function promoteToAdmin(userId: string, newPassword?: string): Promise<User> {
  const passwordHash = newPassword ? await hashPassword(newPassword) : undefined;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { role: 'ADMIN', isDisabled: false, ...(passwordHash ? { passwordHash } : {}) },
    });
    // A password change ends existing sessions, as it does everywhere else in the app.
    if (passwordHash) await refreshTokenRepository.revokeAllForUser(userId, tx);
    return user;
  });
}
