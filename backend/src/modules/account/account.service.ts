import { AppError, conflict, notFound } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { refreshTokenRepository, userRepository } from '../auth/auth.repository.js';
import { accountRepository } from './account.repository.js';
import type { ChangePasswordInput, UpdateAccountInput } from './account.schemas.js';

const wrongPassword = (field: string) =>
  new AppError(400, 'INVALID_PASSWORD', 'The password you entered is incorrect', {
    fieldErrors: { [field]: ['The password you entered is incorrect'] },
  });

async function loadUserOrThrow(userId: string) {
  const user = await userRepository.findById(userId);
  if (!user) throw notFound('USER_NOT_FOUND', 'Account not found');
  return user;
}

export const accountService = {
  async get(userId: string) {
    const account = await accountRepository.find(userId);
    if (!account) throw notFound('USER_NOT_FOUND', 'Account not found');
    return account;
  },

  update(userId: string, input: UpdateAccountInput) {
    return accountRepository.update(userId, input);
  },

  /** Changes the password and signs out every other session, keeping the current one. */
  async changePassword(
    userId: string,
    currentSessionId: string | undefined,
    input: ChangePasswordInput,
  ) {
    const user = await loadUserOrThrow(userId);
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw wrongPassword('currentPassword');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await userRepository.updatePassword(userId, passwordHash, tx);
      await refreshTokenRepository.revokeAllForUser(userId, tx, currentSessionId);
    });
  },

  async deleteAccount(userId: string, password: string) {
    const user = await loadUserOrThrow(userId);
    if (!(await verifyPassword(password, user.passwordHash))) throw wrongPassword('password');
    // Without an admin nobody could manage users, and recovery would need the CLI.
    if (user.role === 'ADMIN' && (await accountRepository.countAdmins()) <= 1) {
      throw conflict('LAST_ADMIN', 'You are the only admin. Promote another admin first.');
    }
    await accountRepository.delete(userId);
  },
};
