import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import {
  downloadChecksCsv,
  useChartChecks,
  useCheckHistory,
  useCheckNow,
  useDeleteMonitor,
  useIncidents,
  useMonitor,
  useUpdateMonitor,
} from '../api/monitors';
import type { MonitorDetail as MonitorDetailData } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button } from '../components/forms';
import { ErrorState, Spinner } from '../components/PageState';
import { ResponseChart } from '../components/ResponseChart';
import { Stat, StatRow } from '../components/Stats';
import { StatusBadge } from '../components/status';
import { useNow } from '../hooks/useNow';
import {
  daysUntil,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMs,
  formatPercent,
  timeAgo,
} from '../lib/format';

export function MonitorDetail() {
  const { id = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useMonitor(id);

  if (isPending) return <Spinner label="Loading monitor" />;
  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <ErrorState
          title={missing ? 'Monitor not found' : undefined}
          message={
            missing
              ? "This monitor doesn't exist or isn't yours."
              : error instanceof ApiError
                ? error.message
                : 'The monitor could not be loaded.'
          }
          onRetry={missing ? undefined : () => void refetch()}
        />
        <Link to="/dashboard" className="font-semibold underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>
    );
  }
  return <MonitorView monitor={data} />;
}

function MonitorView({ monitor }: { monitor: MonitorDetailData }) {
  const navigate = useNavigate();
  const now = useNow();
  const checkNow = useCheckNow();
  const update = useUpdateMonitor();
  const remove = useDeleteMonitor();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const sslDays = daysUntil(monitor.sslExpiresAt, now);

  async function run(action: () => Promise<unknown>, success?: string) {
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <div>
      <Link
        to="/dashboard"
        className="text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        Back to dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[2rem] leading-tight font-semibold tracking-tight">
              {monitor.name}
            </h1>
            <StatusBadge status={monitor.currentStatus} paused={monitor.isPaused} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block break-all text-muted underline underline-offset-4 hover:text-ink"
          >
            {monitor.url}
          </a>
          <p className="mt-1 text-sm text-muted">
            Checked every {monitor.intervalMinutes} minutes, {monitor.timeoutMs / 1000} s timeout.
            Last check {timeAgo(monitor.lastCheckedAt, now).toLowerCase()}.
          </p>
          {monitor.currentStatus === 'DOWN' && monitor.lastCheck?.error && (
            <p className="mt-2 text-sm font-semibold text-down">{monitor.lastCheck.error}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            pending={checkNow.isPending}
            pendingLabel="Checking…"
            onClick={() => void run(() => checkNow.mutateAsync(monitor.id), 'Check complete.')}
          >
            Check now
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void run(() => update.mutateAsync({ id: monitor.id, isPaused: !monitor.isPaused }))
            }
          >
            {monitor.isPaused ? 'Resume' : 'Pause'}
          </Button>
          <Link
            to={`/monitors/${monitor.id}/edit`}
            className="inline-flex items-center rounded-md border border-grid bg-surface px-4 py-2 text-sm font-semibold hover:border-muted"
          >
            Edit
          </Link>
          <Button variant="ghost" className="text-down" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-muted">
        {message}
      </p>

      <div className="mt-4">
        <StatRow>
          <Stat
            label="Uptime, 24 hours"
            value={formatPercent(monitor.stats.uptime24h)}
            detail={`${monitor.stats.checks24h} checks`}
          />
          <Stat label="7 days" value={formatPercent(monitor.stats.uptime7d)} />
          <Stat label="30 days" value={formatPercent(monitor.stats.uptime30d)} />
          <Stat
            label="Average response, 24 hours"
            value={formatMs(monitor.stats.avgResponseMs24h)}
          />
          <Stat
            label="SSL certificate"
            value={sslDays === null ? '—' : sslDays < 0 ? 'Expired' : `${sslDays} days`}
            tone={sslDays !== null && sslDays < 14 ? 'down' : 'ink'}
            detail={
              monitor.sslExpiresAt
                ? `Expires ${formatDate(monitor.sslExpiresAt)}`
                : 'Not checked yet'
            }
          />
        </StatRow>
      </div>

      <section className="mt-10" aria-labelledby="chart-heading">
        <h2 id="chart-heading" className="text-lg font-semibold">
          Response time, last 24 hours
        </h2>
        <p className="text-sm text-muted">Red marks on the baseline are failed checks.</p>
        <div className="mt-4">
          <ChartSection id={monitor.id} now={now} />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="incidents-heading">
        <h2 id="incidents-heading" className="text-lg font-semibold">
          Incidents
        </h2>
        <IncidentsSection id={monitor.id} now={now} />
      </section>

      <section className="mt-10" aria-labelledby="history-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-heading" className="text-lg font-semibold">
            Check history
          </h2>
          <Button
            variant="secondary"
            pending={downloading}
            pendingLabel="Preparing CSV…"
            onClick={() => {
              setDownloading(true);
              void run(() => downloadChecksCsv(monitor.id)).finally(() => setDownloading(false));
            }}
          >
            Download CSV
          </Button>
        </div>
        <HistorySection id={monitor.id} />
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${monitor.name}?`}
        confirmLabel="Delete monitor"
        pending={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onCancel={() => {
          remove.reset();
          setConfirmDelete(false);
        }}
        onConfirm={() =>
          remove.mutate(monitor.id, { onSuccess: () => navigate('/dashboard', { replace: true }) })
        }
      >
        Its check history and incidents are deleted too. This can&apos;t be undone.
      </ConfirmDialog>
    </div>
  );
}

function ChartSection({ id, now }: { id: string; now: number }) {
  const { data, isPending, isError, refetch } = useChartChecks(id);
  if (isPending) return <Spinner label="Loading chart" />;
  if (isError)
    return (
      <ErrorState
        title="Chart unavailable"
        message="The checks could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  if (data.length === 0) {
    return (
      <p className="text-muted">No checks in the last 24 hours yet. Use Check now to run one.</p>
    );
  }
  return <ResponseChart checks={data} now={now} />;
}

function IncidentsSection({ id, now }: { id: string; now: number }) {
  const { data, isPending, isError, refetch } = useIncidents(id);
  if (isPending) return <Spinner label="Loading incidents" />;
  if (isError)
    return (
      <ErrorState
        title="Incidents unavailable"
        message="The incidents could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  if (data.length === 0) {
    return (
      <p className="mt-2 text-muted">
        No incidents. This site hasn&apos;t been down for 2 checks in a row.
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-grid border-y border-grid">
      {data.map((incident) => {
        const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now;
        const duration = formatDuration(end - new Date(incident.startedAt).getTime());
        return (
          <li
            key={incident.id}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 text-sm"
          >
            <span>
              <span className="font-semibold">{formatDateTime(incident.startedAt)}</span>
              <span className="ml-3 text-muted">{incident.cause}</span>
            </span>
            {incident.resolvedAt ? (
              <span className="text-muted">Resolved after {duration}</span>
            ) : (
              <span className="font-semibold text-down">Ongoing for {duration}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HistorySection({ id }: { id: string }) {
  const { data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useCheckHistory(id);
  if (isPending) return <Spinner label="Loading checks" />;
  if (isError)
    return (
      <ErrorState
        title="History unavailable"
        message="The checks could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  const checks = data.pages.flatMap((page) => page.checks);
  if (checks.length === 0) return <p className="mt-2 text-muted">No checks yet.</p>;
  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="sr-only">Check history, newest first</caption>
          <thead>
            <tr className="border-b border-grid text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Time
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Result
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                HTTP
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Response
              </th>
              <th scope="col" className="py-2 font-medium">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.id} className="border-b border-grid">
                <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(check.checkedAt)}</td>
                <td className={`py-2 pr-4 font-semibold ${check.isUp ? 'text-up' : 'text-down'}`}>
                  {check.isUp ? 'Up' : 'Failed'}
                </td>
                <td className="py-2 pr-4 text-right">{check.statusCode ?? '—'}</td>
                <td className="py-2 pr-4 text-right">
                  {check.isUp ? formatMs(check.responseTimeMs) : '—'}
                </td>
                <td className="py-2 text-muted">{check.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasNextPage && (
        <Button
          variant="secondary"
          className="mt-4"
          pending={isFetchingNextPage}
          pendingLabel="Loading…"
          onClick={() => void fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </>
  );
}
