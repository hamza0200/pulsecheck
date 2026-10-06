import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Check } from '../api/types';
import { formatMs } from '../lib/format';

interface Point {
  t: number;
  /** Response time of a successful check; null breaks the line at failures. */
  ms: number | null;
  /** Failed checks sit on the baseline as red marks. */
  failed: number | null;
  check: Check;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const { check } = point;
  return (
    <div className="rounded-md border border-grid bg-surface px-3 py-2 text-sm shadow-md">
      <p className="font-semibold">{new Date(check.checkedAt).toLocaleString()}</p>
      {check.isUp ? (
        <p className="text-muted">
          Up, {formatMs(check.responseTimeMs)}
          {check.statusCode ? ` (HTTP ${check.statusCode})` : ''}
        </p>
      ) : (
        <p className="text-down">Failed: {check.error ?? 'unknown error'}</p>
      )}
    </div>
  );
}

/** A downward triangle on the baseline: failures differ by shape, not only colour. */
function FailureMark({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <path
      d={`M${cx - 5} ${cy - 9} L${cx + 5} ${cy - 9} L${cx} ${cy - 1} Z`}
      fill="var(--color-down)"
      stroke="var(--color-surface)"
      strokeWidth={1.5}
    />
  );
}

/**
 * Response time over the last 24 hours. One series, so no legend: the section heading
 * names it, and a caption explains the red failure marks. The checks table below is the
 * accessible table view of the same data.
 */
export function ResponseChart({ checks, now }: { checks: Check[]; now: number }) {
  const data: Point[] = checks.map((check) => ({
    t: new Date(check.checkedAt).getTime(),
    ms: check.isUp ? check.responseTimeMs : null,
    failed: check.isUp ? null : 0,
    check,
  }));

  return (
    <div
      className="h-64 w-full"
      role="img"
      aria-label={`Response time chart with ${checks.length} checks from the last 24 hours`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-grid)" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[now - 24 * 60 * 60 * 1000, now]}
            tickFormatter={(t: number) => timeFormat.format(t)}
            tick={{ fill: 'var(--color-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-grid)' }}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(ms: number) => `${ms.toLocaleString()} ms`}
            tick={{ fill: 'var(--color-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={72}
            allowDecimals={false}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="ms"
            stroke="var(--color-ink)"
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--color-ink)',
              stroke: 'var(--color-surface)',
              strokeWidth: 2,
            }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Scatter dataKey="failed" shape={<FailureMark />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
