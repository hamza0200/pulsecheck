import { Link } from 'react-router';

/** Wordmark: a single heartbeat glyph and the product name. */
export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
      <svg viewBox="0 0 24 24" className="size-6 text-up" aria-hidden="true">
        <path
          d="M1 13h5l2.5-6 4 11 3-8 1.5 3H23"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      PulseCheck
    </Link>
  );
}

/**
 * A full-width ECG trace: flat line, one heartbeat, flat line. The SVG stretches to any
 * width; non-scaling-stroke keeps the line weight constant while it does.
 */
export function PulseTrace() {
  return (
    <svg
      className="pulse-trace block h-24 w-full text-up"
      viewBox="0 0 1200 96"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0 60 H300 L318 60 L330 48 L342 60 H360 L374 60 L384 74 L402 6 L420 90 L432 60 H450 L470 60 L486 44 L506 60 H1200"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
