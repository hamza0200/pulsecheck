import type { ReactNode } from 'react';
import { Button } from './forms';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-grid border-t-ink motion-reduce:animate-none"
      />
      {label}…
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner />
    </div>
  );
}

export function ErrorState({
  title = "Couldn't load this page",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="max-w-lg py-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="max-w-lg py-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  );
}
