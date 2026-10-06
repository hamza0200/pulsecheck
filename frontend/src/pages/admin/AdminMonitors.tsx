import { useDeferredValue, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAdminMonitors } from '../../api/admin';
import type { AdminMonitorStatusFilter } from '../../api/types';
import { Button, TextField } from '../../components/forms';
import { EmptyState, ErrorState, Spinner } from '../../components/PageState';
import { StatusBadge } from '../../components/status';
import { useNow } from '../../hooks/useNow';
import { timeAgo } from '../../lib/format';

const statusOptions: { value: AdminMonitorStatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'DOWN', label: 'Down' },
  { value: 'UP', label: 'Up' },
  { value: 'UNKNOWN', label: 'Pending' },
  { value: 'PAUSED', label: 'Paused' },
];

/**
 * Every user's monitors, read-only. Admins can see URLs and who owns them, but monitors
 * can only be changed by their owner.
 */
export function AdminMonitors() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('userId') ?? '';
  const ownerEmail = params.get('email') ?? '';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminMonitorStatusFilter>('');
  const deferredSearch = useDeferredValue(search.trim());
  const now = useNow();
  const statusId = useId();

  const monitors = useAdminMonitors({ search: deferredSearch, userId, status });
  const rows = monitors.data?.pages.flatMap((page) => page.monitors) ?? [];

  return (
    <div>
      <h2 className="sr-only">All monitors</h2>
      {userId && (
        <p className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span>
            Showing monitors of{' '}
            <strong className="font-semibold">{ownerEmail || 'one user'}</strong>
          </span>
          <button
            type="button"
            className="font-semibold underline underline-offset-4"
            onClick={() => setParams({})}
          >
            Show all users
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <TextField
          className="w-full max-w-sm"
          label="Search by URL, name or owner email"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div>
          <label htmlFor={statusId} className="block text-sm font-medium">
            Status
          </label>
          <select
            id={statusId}
            value={status}
            onChange={(e) => setStatus(e.target.value as AdminMonitorStatusFilter)}
            className="mt-1.5 block rounded-md border border-grid bg-surface px-3 py-2 text-base hover:border-muted focus:border-ink"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {monitors.isPending ? (
        <div className="mt-6">
          <Spinner label="Loading monitors" />
        </div>
      ) : monitors.isError ? (
        <ErrorState
          message="The monitors could not be loaded."
          onRetry={() => void monitors.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No monitors match these filters" />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
              <caption className="sr-only">All users' monitors, newest first</caption>
              <thead>
                <tr className="border-b border-grid text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Monitor
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Owner
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Every
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Last checked
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-grid">
                    <td className="py-3 pr-4">
                      <StatusBadge status={m.currentStatus} paused={m.isPaused} />
                    </td>
                    <td className="max-w-80 py-3 pr-4">
                      <span className="block truncate font-semibold">{m.name}</span>
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-muted underline underline-offset-4 hover:text-ink"
                      >
                        {m.url}
                      </a>
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        to={`/admin/monitors?userId=${m.owner.id}&email=${encodeURIComponent(m.owner.email)}`}
                        className="hover:underline hover:underline-offset-4"
                      >
                        {m.owner.email}
                      </Link>
                      {m.owner.isDisabled && <span className="ml-2 text-down">(disabled)</span>}
                    </td>
                    <td className="py-3 pr-4 text-right whitespace-nowrap">
                      {m.intervalMinutes} min
                    </td>
                    <td className="py-3 whitespace-nowrap text-muted">
                      {timeAgo(m.lastCheckedAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {monitors.hasNextPage && (
            <Button
              variant="secondary"
              className="mt-4"
              pending={monitors.isFetchingNextPage}
              pendingLabel="Loading…"
              onClick={() => void monitors.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
