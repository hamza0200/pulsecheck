import type { MonitorStatus } from '../api/types';

const statusStyle: Record<MonitorStatus | 'PAUSED', { label: string; className: string }> = {
  UP: { label: 'Up', className: 'bg-up-soft text-up' },
  DOWN: { label: 'Down', className: 'bg-down-soft text-down' },
  UNKNOWN: { label: 'Pending', className: 'bg-grid/60 text-muted' },
  PAUSED: { label: 'Paused', className: 'bg-grid/60 text-muted' },
};

/** Status is never colour alone: each state has its own glyph and a word. */
function Glyph({ status }: { status: MonitorStatus | 'PAUSED' }) {
  const common = { className: 'size-3', viewBox: '0 0 12 12', 'aria-hidden': true } as const;
  switch (status) {
    case 'UP':
      return (
        <svg {...common}>
          <path
            d="M2 7.5 5 10l5-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'DOWN':
      return (
        <svg {...common}>
          <path
            d="M3 3l6 6M9 3 3 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'PAUSED':
      return (
        <svg {...common}>
          <path
            d="M4 2.5v7M8 2.5v7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle
            cx="6"
            cy="6"
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeDasharray="2 2"
          />
        </svg>
      );
  }
}

export function StatusBadge({
  status,
  paused = false,
}: {
  status: MonitorStatus;
  paused?: boolean;
}) {
  const key = paused ? 'PAUSED' : status;
  const { label, className } = statusStyle[key];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${className}`}
    >
      <Glyph status={key} />
      {label}
    </span>
  );
}

/**
 * The dashboard's signature: the last checks drawn like a chart-recorder strip, oldest on
 * the left. Up is a short green tick; a failure is a full-height red tick, so failures
 * stand out by height as well as colour. Empty slots show a faint baseline.
 */
export function CheckStrip({
  checks,
  slots = 30,
}: {
  checks: { checkedAt: string; isUp: boolean }[];
  slots?: number;
}) {
  const recent = checks.slice(-slots);
  const failures = recent.filter((c) => !c.isUp).length;
  const label =
    recent.length === 0
      ? 'No checks yet'
      : `Last ${recent.length} checks: ${recent.length - failures} up, ${failures} failed`;
  const padding = slots - recent.length;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${slots * 5} 20`}
      className="h-5 w-[150px] shrink-0"
      preserveAspectRatio="none"
    >
      <title>{label}</title>
      <line x1="0" x2={slots * 5} y1="19.5" y2="19.5" stroke="var(--color-grid)" strokeWidth="1" />
      {recent.map((check, i) => {
        const x = (padding + i) * 5 + 1;
        return check.isUp ? (
          <rect
            key={check.checkedAt}
            x={x}
            y={10}
            width={3}
            height={10}
            rx={1}
            fill="var(--color-up)"
          />
        ) : (
          <rect
            key={check.checkedAt}
            x={x}
            y={0}
            width={3}
            height={20}
            rx={1}
            fill="var(--color-down)"
          />
        );
      })}
    </svg>
  );
}
