import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { SsrfError, assertPublicUrl } from '../../lib/ssrf-guard.js';
import { checksRepository } from '../checks/checks.repository.js';
import { checkMonitorById, isMonitorInFlight } from '../checks/runner.js';
import { incidentsRepository } from '../incidents/incidents.repository.js';
import { incidentsService } from '../incidents/incidents.service.js';
import { type MonitorDto, monitorRepository } from './monitors.repository.js';
import type {
  CreateMonitorInput,
  ListChecksQuery,
  UpdateMonitorInput,
} from './monitors.schemas.js';

export const monitorNotFound = () => notFound('MONITOR_NOT_FOUND', 'Monitor not found');

/** Runs the SSRF guard and turns its errors into a 400 on the `url` field. */
async function assertSafeUrl(url: string): Promise<void> {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw badRequest(err.code, err.message, { fieldErrors: { url: [err.message] } });
    }
    throw err;
  }
}

function defaultName(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
const duplicateUrl = () => conflict('MONITOR_EXISTS', 'You are already monitoring this URL');

// Opaque cursors: clients pass them back unchanged and never depend on their format.
function encodeCursor(row: { checkedAt: Date; id: string }): string {
  return Buffer.from(`${row.checkedAt.toISOString()}|${row.id}`).toString('base64url');
}
function decodeCursor(cursor: string): { checkedAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const checkedAt = new Date(iso ?? '');
  if (!id || Number.isNaN(checkedAt.getTime())) {
    throw badRequest('INVALID_CURSOR', 'The pagination cursor is invalid');
  }
  return { checkedAt, id };
}

async function requireOwned(userId: string, id: string): Promise<MonitorDto> {
  const monitor = await monitorRepository.findOwned(id, userId);
  if (!monitor) throw monitorNotFound();
  return monitor;
}

export const monitorsService = {
  async list(userId: string) {
    const monitors = await monitorRepository.listForUser(userId);
    const ids = monitors.map((m) => m.id);
    const [latest, uptime] = await Promise.all([
      monitorRepository.latestChecks(ids),
      monitorRepository.uptime24h(ids),
    ]);
    return {
      monitors: monitors.map((m) => ({
        ...m,
        lastCheck: latest.get(m.id) ?? null,
        uptime24h: uptime.get(m.id) ?? null,
      })),
      usage: { used: monitors.length, max: env.MAX_MONITORS_PER_USER },
    };
  },

  async get(userId: string, id: string) {
    const monitor = await requireOwned(userId, id);
    const [stats, latest] = await Promise.all([
      monitorRepository.uptimeStats(id),
      monitorRepository.latestChecks([id]),
    ]);
    return { ...monitor, lastCheck: latest.get(id) ?? null, stats };
  },

  async create(userId: string, input: CreateMonitorInput): Promise<MonitorDto> {
    await assertSafeUrl(input.url);
    try {
      return await prisma.$transaction(async (tx) => {
        await monitorRepository.lockUser(userId, tx);
        if ((await monitorRepository.countForUser(userId, tx)) >= env.MAX_MONITORS_PER_USER) {
          throw new AppError(
            409,
            'MONITOR_LIMIT_REACHED',
            `You can have at most ${env.MAX_MONITORS_PER_USER} monitors`,
          );
        }
        return monitorRepository.create(
          {
            userId,
            url: input.url,
            name: input.name ?? defaultName(input.url),
            intervalMinutes: input.intervalMinutes,
            timeoutMs: input.timeoutMs,
          },
          tx,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateUrl();
      throw err;
    }
  },

  async update(userId: string, id: string, input: UpdateMonitorInput): Promise<MonitorDto> {
    const existing = await requireOwned(userId, id);
    const urlChanged = input.url !== undefined && input.url !== existing.url;
    if (urlChanged) await assertSafeUrl(input.url!);

    try {
      await prisma.$transaction(async (tx) => {
        await monitorRepository.updateOwned(
          id,
          userId,
          {
            ...input,
            // A different URL is a different site: forget the old site's state.
            ...(urlChanged
              ? {
                  currentStatus: 'UNKNOWN',
                  consecutiveFailures: 0,
                  lastCheckedAt: null,
                  sslExpiresAt: null,
                  sslCheckedAt: null,
                }
              : {}),
          },
          tx,
        );
        if (urlChanged) await incidentsRepository.resolveOpen(id, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateUrl();
      throw err;
    }
    return requireOwned(userId, id);
  },

  async remove(userId: string, id: string): Promise<void> {
    if (!(await monitorRepository.deleteOwned(id, userId))) throw monitorNotFound();
  },

  async listChecks(userId: string, id: string, query: ListChecksQuery) {
    await requireOwned(userId, id);
    const rows = await checksRepository.listPage(id, {
      limit: query.limit,
      after: query.cursor ? decodeCursor(query.cursor) : undefined,
      since: query.since ? new Date(query.since) : undefined,
    });
    const hasMore = rows.length > query.limit;
    const checks = hasMore ? rows.slice(0, query.limit) : rows;
    const last = checks.at(-1);
    return { checks, nextCursor: hasMore && last ? encodeCursor(last) : null };
  },

  /** Runs one check right now, outside the schedule (even if the monitor is paused). */
  async checkNow(userId: string, id: string) {
    await requireOwned(userId, id);
    const inProgress = () =>
      conflict('CHECK_IN_PROGRESS', 'This monitor is being checked right now, try again shortly');
    if (isMonitorInFlight(id)) throw inProgress();
    const outcome = await checkMonitorById(id);
    if (!outcome) throw inProgress();
    const { result, checkedAt } = outcome;
    return {
      check: {
        checkedAt,
        isUp: result.isUp,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      },
      monitor: await monitorsService.get(userId, id),
    };
  },

  async listIncidents(userId: string, id: string, limit: number) {
    await requireOwned(userId, id);
    return { incidents: await incidentsService.listForMonitor(id, limit) };
  },
};
