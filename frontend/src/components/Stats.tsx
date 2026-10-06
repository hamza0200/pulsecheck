import type { ReactNode } from 'react';

/**
 * A row of headline figures separated by hairlines (a <dl>, so label/value pairs are
 * announced together). Deliberately not a grid of identical cards.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 border-y border-grid sm:flex sm:divide-x sm:divide-grid">
      {children}
    </dl>
  );
}

export function Stat({
  label,
  value,
  detail,
  tone = 'ink',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'ink' | 'down' | 'up';
}) {
  const color = tone === 'down' ? 'text-down' : tone === 'up' ? 'text-up' : 'text-ink';
  return (
    <div className="px-1 py-4 sm:flex-1 sm:px-5 sm:first:pl-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-1 text-[1.75rem] leading-none font-semibold ${color}`}>{value}</dd>
      {detail && <dd className="mt-1.5 text-sm text-muted">{detail}</dd>}
    </div>
  );
}
