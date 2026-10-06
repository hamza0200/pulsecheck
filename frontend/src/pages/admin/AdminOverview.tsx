import { useAdminStats } from '../../api/admin';
import { ErrorState, Spinner } from '../../components/PageState';
import { Stat, StatRow } from '../../components/Stats';
import { useNow } from '../../hooks/useNow';
import { formatDateTime, timeAgo } from '../../lib/format';

export function AdminOverview() {
  const { data, isPending, isError, refetch } = useAdminStats();
  const now = useNow();
  if (isPending) return <Spinner label="Loading system stats" />;
  if (isError) {
    return (
      <ErrorState message="System stats could not be loaded." onRetry={() => void refetch()} />
    );
  }
  const { users, monitors, lastRun } = data;
  return (
    <div>
      <h2 className="text-lg font-semibold">Accounts and monitors</h2>
      <div className="mt-3">
        <StatRow>
          <Stat
            label="Users"
            value={users.total}
            detail={`${users.admins} admin, ${users.disabled} disabled`}
          />
          <Stat label="Monitors" value={monitors.total} detail={`${monitors.paused} paused`} />
          <Stat label="Up" value={monitors.up} tone={monitors.up ? 'up' : 'ink'} />
          <Stat label="Down" value={monitors.down} tone={monitors.down ? 'down' : 'ink'} />
          <Stat label="Checks, last 24 hours" value={data.checksLast24h.toLocaleString()} />
        </StatRow>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Last check run</h2>
      {!data.schedulerEnabled && (
        <p className="mt-2 text-sm text-down">
          The scheduler is turned off (SCHEDULER_ENABLED=false), so checks only run on demand.
        </p>
      )}
      {lastRun ? (
        <div className="mt-3">
          <StatRow>
            <Stat
              label="Finished"
              value={timeAgo(lastRun.finishedAt, now)}
              detail={formatDateTime(lastRun.finishedAt)}
            />
            <Stat label="Checked" value={lastRun.checked} />
            <Stat label="Succeeded" value={lastRun.up} />
            <Stat label="Failed" value={lastRun.down} tone={lastRun.down ? 'down' : 'ink'} />
            <Stat
              label="Duration"
              value={`${(lastRun.durationMs / 1000).toFixed(1)} s`}
              detail={lastRun.errors ? `${lastRun.errors} crashed` : undefined}
            />
          </StatRow>
        </div>
      ) : (
        <p className="mt-2 text-muted">
          No run has finished since the server started. The scheduler runs every minute.
        </p>
      )}
    </div>
  );
}
