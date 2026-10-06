import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { useCheckNow, useDeleteMonitor, useMonitors, useUpdateMonitor } from '../api/monitors';
import type { MonitorListItem } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../components/forms';
import { EmptyState, ErrorState, Spinner } from '../components/PageState';
import { Stat, StatRow } from '../components/Stats';
import { CheckStrip, StatusBadge } from '../components/status';
import { type StreamState, useStatusStream } from '../hooks/useStatusStream';
import { useNow } from '../hooks/useNow';
import { daysUntil, formatMs, formatPercent, hostOf, timeAgo } from '../lib/format';

const linkButton =
  'inline-flex items-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink/90';

function LiveIndicator({ state }: { state: StreamState }) {
  const text = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' }[state];
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${
          state === 'live' ? 'bg-up' : 'animate-pulse bg-unknown motion-reduce:animate-none'
        }`}
      />
      {text}
    </span>
  );
}

/** Down first, then pending, then up; paused monitors last. */
function sortForTriage(monitors: MonitorListItem[]) {
  const rank = (m: MonitorListItem) =>
    m.isPaused ? 3 : m.currentStatus === 'DOWN' ? 0 : m.currentStatus === 'UNKNOWN' ? 1 : 2;
  return [...monitors].sort((a, b) => rank(a) - rank(b));
}

function SslCell({ expiresAt, now }: { expiresAt: string | null; now: number }) {
  const days = daysUntil(expiresAt, now);
  if (days === null) return <span className="text-muted">—</span>;
  if (days < 0) return <span className="font-semibold text-down">Expired</span>;
  return (
    <span className={days < 14 ? 'font-semibold text-down' : undefined}>
      {days} day{days === 1 ? '' : 's'}
    </span>
  );
}

export function Dashboard() {
  const { data, isPending, isError, error, refetch } = useMonitors();
  const { state: streamState, notice } = useStatusStream();
  const now = useNow();
  const checkNow = useCheckNow();
  const update = useUpdateMonitor();
  const remove = useDeleteMonitor();
  const [message, setMessage] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MonitorListItem | null>(null);

  async function runAction(action: () => Promise<unknown>, success?: string) {
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  if (isPending) return <Spinner label="Loading monitors" />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : 'The monitors could not be loaded.'}
        onRetry={() => void refetch()}
      />
    );
  }

  const { monitors, usage } = data;
  const active = monitors.filter((m) => !m.isPaused);
  const up = active.filter((m) => m.currentStatus === 'UP').length;
  const down = active.filter((m) => m.currentStatus === 'DOWN').length;
  const responseTimes = active
    .map((m) => (m.lastCheck?.isUp ? m.lastCheck.responseTimeMs : null))
    .filter((v): v is number => v !== null);
  const avgResponse = responseTimes.length
    ? responseTimes.reduce((sum, v) => sum + v, 0) / responseTimes.length
    : null;
  const atLimit = usage.used >= usage.max;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {usage.used} of {usage.max} monitors used
          </p>
        </div>
        <div className="flex items-center gap-5">
          <LiveIndicator state={streamState} />
          {atLimit ? (
            <span className="text-sm text-muted">Monitor limit reached</span>
          ) : (
            <Link to="/monitors/new" className={linkButton}>
              Add monitor
            </Link>
          )}
        </div>
      </div>

      <div aria-live="polite" className="mt-4 space-y-2 empty:hidden">
        {notice && (
          <p
            key={notice.at}
            className={`rounded-md border px-3.5 py-2.5 text-sm ${
              notice.kind === 'down'
                ? 'border-down/30 bg-down-soft text-down'
                : 'border-up/30 bg-up-soft text-ink'
            }`}
          >
            {notice.kind === 'down'
              ? `${notice.name} just went down.`
              : `${notice.name} is back up.`}
          </p>
        )}
        {message && <p className="text-sm text-muted">{message}</p>}
      </div>

      {monitors.length === 0 ? (
        <EmptyState title="No monitors yet">
          <p>Add a website and PulseCheck will check it every few minutes.</p>
          <Link to="/monitors/new" className={`${linkButton} mt-5`}>
            Add your first monitor
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="mt-6">
            <StatRow>
              <Stat
                label="Monitors"
                value={monitors.length}
                detail={`${monitors.length - active.length} paused`}
              />
              <Stat label="Up" value={up} tone={up > 0 ? 'up' : 'ink'} />
              <Stat label="Down" value={down} tone={down > 0 ? 'down' : 'ink'} />
              <Stat
                label="Average response"
                value={avgResponse === null ? '—' : formatMs(avgResponse)}
                detail="Latest successful checks"
              />
            </StatRow>
          </div>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-240 border-collapse text-left text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <caption className="sr-only">Your monitors, down ones first</caption>
              <thead>
                <tr className="border-b border-grid text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Monitor
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Last 30 checks
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Response
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Uptime 24h
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    SSL expires in
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortForTriage(monitors).map((m) => (
                  <tr key={m.id} className="border-b border-grid align-middle">
                    <td className="py-3 pr-4">
                      <StatusBadge status={m.currentStatus} paused={m.isPaused} />
                    </td>
                    <td className="max-w-56 py-3 pr-4">
                      <Link
                        to={`/monitors/${m.id}`}
                        className="block truncate font-semibold hover:underline hover:underline-offset-4"
                      >
                        {m.name}
                      </Link>
                      {hostOf(m.url) !== m.name && (
                        <span className="block truncate text-muted">{hostOf(m.url)}</span>
                      )}
                      <span className="block text-muted">
                        {m.lastCheckedAt
                          ? `Checked ${timeAgo(m.lastCheckedAt, now).toLowerCase()}`
                          : 'Not checked yet'}
                      </span>
                      {m.currentStatus === 'DOWN' && m.lastCheck?.error && (
                        <span className="block truncate text-down" title={m.lastCheck.error}>
                          {m.lastCheck.error}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <CheckStrip checks={m.recentChecks} />
                    </td>
                    <td className="py-3 pr-4 text-right">
                      {m.lastCheck?.isUp ? formatMs(m.lastCheck.responseTimeMs) : '—'}
                    </td>
                    <td className="py-3 pr-4 text-right">{formatPercent(m.uptime24h)}</td>
                    <td className="py-3 pr-4 text-right">
                      <SslCell expiresAt={m.sslExpiresAt} now={now} />
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          pending={checkNow.isPending && checkNow.variables === m.id}
                          pendingLabel="Checking…"
                          onClick={() =>
                            void runAction(() => checkNow.mutateAsync(m.id), `Checked ${m.name}.`)
                          }
                        >
                          Check now
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          onClick={() =>
                            void runAction(() =>
                              update.mutateAsync({ id: m.id, isPaused: !m.isPaused }),
                            )
                          }
                        >
                          {m.isPaused ? 'Resume' : 'Pause'}
                        </Button>
                        <Link
                          to={`/monitors/${m.id}/edit`}
                          className="inline-flex items-center rounded-md px-2 py-1 font-semibold hover:bg-grid/60"
                        >
                          Edit
                        </Link>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-down"
                          onClick={() => setToDelete(m)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete?.name ?? 'monitor'}?`}
        confirmLabel="Delete monitor"
        pending={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onCancel={() => {
          remove.reset();
          setToDelete(null);
        }}
        onConfirm={() => {
          if (!toDelete) return;
          remove.mutate(toDelete.id, {
            onSuccess: () => {
              setMessage(`Deleted ${toDelete.name}.`);
              setToDelete(null);
            },
          });
        }}
      >
        Its check history and incidents are deleted too. This can&apos;t be undone.
      </ConfirmDialog>
    </div>
  );
}
