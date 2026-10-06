import { env } from '../../config/env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { events } from '../../lib/events.js';
import { prisma } from '../../lib/prisma.js';
import { refreshTokenRepository } from '../auth/auth.repository.js';
import { getLastRunSummary } from '../checks/runner.js';
import { adminRepository, toAdminUser } from './admin.repository.js';
import type { ListUsersQuery, UpdateUserInput } from './admin.schemas.js';

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw badRequest('INVALID_CURSOR', 'The pagination cursor is invalid');
  }
  return { createdAt, id };
}

export const adminService = {
  async stats() {
    const s = await adminRepository.stats();
    const up = s.byStatus.UP ?? 0;
    const down = s.byStatus.DOWN ?? 0;
    const unknown = s.byStatus.UNKNOWN ?? 0;
    return {
      users: { total: s.users, admins: s.admins, disabled: s.disabledUsers },
      monitors: { total: up + down + unknown, up, down, unknown, paused: s.pausedMonitors },
      checksLast24h: s.checksLast24h,
      lastRun: getLastRunSummary(),
      schedulerEnabled: env.SCHEDULER_ENABLED,
    };
  },

  async listUsers(query: ListUsersQuery) {
    const rows = await adminRepository.listUsers({
      limit: query.limit,
      search: query.search || undefined,
      after: query.cursor ? decodeCursor(query.cursor) : undefined,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      users: page.map(toAdminUser),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  },

  /** Disables or re-enables a user. Disabling also ends all of their sessions. */
  async setDisabled(actorId: string, targetId: string, input: UpdateUserInput) {
    if (actorId === targetId && input.isDisabled) {
      throw badRequest('CANNOT_DISABLE_SELF', 'You cannot disable your own account');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: targetId },
        data: { isDisabled: input.isDisabled },
      });
      if (result.count === 0) return false;
      if (input.isDisabled) await refreshTokenRepository.revokeAllForUser(targetId, tx);
      return true;
    });
    if (!updated) throw notFound('USER_NOT_FOUND', 'User not found');

    // Access tokens are already blocked by requireAuth's database check; this also cuts
    // any open live-update streams.
    if (input.isDisabled) events.emit('user.disabled', { userId: targetId });

    const user = await adminRepository.findUser(targetId);
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
    return toAdminUser(user);
  },
};
