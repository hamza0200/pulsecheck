import { setTimeout as sleep } from 'node:timers/promises';
import { runWithLimit } from '../../lib/concurrency.js';
import { events } from '../../lib/events.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { MonitorStatus } from '../../generated/prisma/client.js';
import { incidentsRepository } from '../incidents/incidents.repository.js';
import { type CheckResult, performCheck } from './checker.js';
import { type DueMonitor, dueMonitorsRepository } from './checks.repository.js';
import { SSL_WARNING_DAYS, daysUntil, getCertificateExpiry, isSslCheckDue } from './ssl.js';
import { nextState } from './state-machine.js';

export const RUN_CONCURRENCY = 5;

export interface RunSummary {
  checked: number;
  up: number;
  down: number;
  /** Checks that threw unexpectedly (e.g. database error), not sites that were down. */
  errors: number;
  durationMs: number;
  startedAt: Date;
  finishedAt: Date;
}

export interface MonitorCheckOutcome {
  result: CheckResult;
  status: MonitorStatus;
  consecutiveFailures: number;
  checkedAt: Date;
}

let currentRun: Promise<RunSummary> | null = null;
let lastRun: RunSummary | null = null;
/** Monitors being checked right now (by the runner or "check now"). */
const inFlight = new Set<string>();

export function getLastRunSummary(): RunSummary | null {
  return lastRun;
}

/** Saves the check and moves the state machine, atomically. Returns null if the monitor vanished. */
async function recordResult(monitor: DueMonitor, result: CheckResult) {
  const checkedAt = new Date();
  // [Node concept: database transactions] The check row, the monitor's new state and any
  // incident change commit together or not at all. FOR UPDATE locks the monitor row, so a
  // "check now" racing the scheduler can't both read failures=1 and both open an incident.
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<
      { status: MonitorStatus; consecutiveFailures: number; url: string }[]
    >`SELECT current_status AS status, consecutive_failures AS "consecutiveFailures", url
      FROM monitors WHERE id = ${monitor.id}::uuid FOR UPDATE`;
    // Deleted mid-check, or the user changed the URL: this result is about something else.
    if (!row || row.url !== monitor.url) return null;

    const next = nextState(row, result.isUp);
    await tx.check.create({
      data: {
        monitorId: monitor.id,
        checkedAt,
        isUp: result.isUp,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      },
    });

    let downSince: Date | null = null;
    if (next.transition === 'down') {
      await incidentsRepository.open(monitor.id, result.error ?? 'Unknown error', tx);
    } else if (next.transition === 'recovered') {
      downSince = (await incidentsRepository.findOpen(monitor.id, tx))?.startedAt ?? null;
      await incidentsRepository.resolveOpen(monitor.id, tx);
    }

    await tx.monitor.update({
      where: { id: monitor.id },
      data: {
        currentStatus: next.status,
        consecutiveFailures: next.consecutiveFailures,
        lastCheckedAt: checkedAt,
      },
    });
    return { next, checkedAt, downSince };
  });
}

async function checkSsl(monitor: DueMonitor): Promise<void> {
  const hostname = new URL(monitor.url).hostname;
  let expiresAt: Date | null = null;
  try {
    expiresAt = await getCertificateExpiry(hostname);
  } catch (err) {
    logger.warn({ err, monitorId: monitor.id, hostname }, 'SSL certificate check failed');
  }
  // Record the attempt even on failure, so a broken host is retried tomorrow, not every tick.
  await prisma.monitor.updateMany({
    where: { id: monitor.id },
    data: { sslCheckedAt: new Date(), ...(expiresAt ? { sslExpiresAt: expiresAt } : {}) },
  });
  if (expiresAt) {
    const daysLeft = daysUntil(expiresAt);
    // isSslCheckDue limits this to once per 24h, so the warning goes out at most daily.
    if (daysLeft < SSL_WARNING_DAYS) {
      events.emit('monitor.sslExpiring', {
        userId: monitor.userId,
        monitorId: monitor.id,
        name: monitor.name,
        url: monitor.url,
        expiresAt,
        daysLeft,
      });
    }
  }
}

/**
 * Checks one monitor end to end: HTTP check (with SSRF guard and retry), transactional
 * state update, events, and the daily SSL check. Returns null if the monitor is already
 * being checked or no longer exists.
 */
export async function checkMonitor(monitor: DueMonitor): Promise<MonitorCheckOutcome | null> {
  if (inFlight.has(monitor.id)) return null;
  inFlight.add(monitor.id);
  try {
    const result = await performCheck(monitor.url, monitor.timeoutMs);
    const saved = await recordResult(monitor, result);
    if (!saved) return null;

    const ref = {
      userId: monitor.userId,
      monitorId: monitor.id,
      name: monitor.name,
      url: monitor.url,
    };
    // The runner only emits. Who listens (email, SSE) is none of its business.
    events.emit('monitor.checked', {
      ...ref,
      status: saved.next.status,
      checkedAt: saved.checkedAt,
      isUp: result.isUp,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
      consecutiveFailures: saved.next.consecutiveFailures,
    });
    if (saved.next.transition === 'down') {
      events.emit('monitor.down', {
        ...ref,
        cause: result.error ?? 'Unknown error',
        startedAt: saved.checkedAt,
      });
    } else if (saved.next.transition === 'recovered') {
      events.emit('monitor.recovered', {
        ...ref,
        downSince: saved.downSince,
        recoveredAt: saved.checkedAt,
      });
    }

    if (isSslCheckDue(monitor.url, monitor.sslCheckedAt)) await checkSsl(monitor);

    return {
      result,
      status: saved.next.status,
      consecutiveFailures: saved.next.consecutiveFailures,
      checkedAt: saved.checkedAt,
    };
  } finally {
    inFlight.delete(monitor.id);
  }
}

/** Checks a single monitor by id, regardless of schedule ("check now"). */
export async function checkMonitorById(id: string): Promise<MonitorCheckOutcome | null> {
  const monitor = await dueMonitorsRepository.findOne(id);
  return monitor ? checkMonitor(monitor) : null;
}

export function isMonitorInFlight(id: string): boolean {
  return inFlight.has(id);
}

async function executeRun(): Promise<RunSummary> {
  const startedAt = new Date();
  const started = performance.now();
  const due = await dueMonitorsRepository.findDue();

  // [Node concept: concurrency] Checks are I/O-bound (waiting on remote servers), so
  // running several at once is nearly free for the event loop. The limit keeps us polite
  // and bounds open sockets. allSettled semantics: one failure never stops the rest.
  const settled = await runWithLimit(
    due.map((monitor) => () => checkMonitor(monitor)),
    RUN_CONCURRENCY,
  );

  const summary: RunSummary = {
    checked: 0,
    up: 0,
    down: 0,
    errors: 0,
    durationMs: 0,
    startedAt,
    finishedAt: startedAt,
  };
  settled.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      summary.errors++;
      logger.error({ err: outcome.reason, monitorId: due[i]?.id }, 'Monitor check crashed');
    } else if (outcome.value) {
      summary.checked++;
      if (outcome.value.result.isUp) summary.up++;
      else summary.down++;
    }
  });
  summary.durationMs = Math.round(performance.now() - started);
  summary.finishedAt = new Date();
  return summary;
}

/**
 * Runs every due check once. Overlap guard: if a run is still going (a slow site, a big
 * backlog), a new trigger returns null immediately instead of starting a second run that
 * would double-check the same monitors. This is per process; several instances would
 * need a Postgres advisory lock (see docs/decisions.md).
 */
export async function runChecks(): Promise<RunSummary | null> {
  if (currentRun) {
    logger.debug('Check run already in progress; skipping this trigger');
    return null;
  }
  currentRun = executeRun();
  try {
    const summary = await currentRun;
    // Most ticks find nothing due; keep the last run that actually did work, so the admin
    // overview shows a meaningful summary instead of "checked 0".
    if (summary.checked + summary.errors > 0 || !lastRun) lastRun = summary;
    const { checked, up, down, errors, durationMs } = summary;
    logger.info({ checked, up, down, errors, durationMs }, 'Check run finished');
    return summary;
  } finally {
    currentRun = null;
  }
}

/** For graceful shutdown: resolves when the current run ends, or after `capMs`. */
export async function waitForCurrentRun(capMs: number): Promise<void> {
  if (!currentRun) return;
  // unref'd timer: the cap itself must not keep the process alive.
  await Promise.race([currentRun.catch(() => undefined), sleep(capMs, undefined, { ref: false })]);
}
