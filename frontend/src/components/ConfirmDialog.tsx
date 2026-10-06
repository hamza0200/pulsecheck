import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from './forms';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation built on the native <dialog> element: showModal() gives focus
 * trapping, Escape to close and an inert background for free.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-grid bg-surface p-6 text-ink shadow-xl backdrop:bg-ink/40"
    >
      {open && (
        <>
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          {children && <div className="mt-2 text-muted">{children}</div>}
          {error && (
            <p role="alert" className="mt-3 text-sm text-down">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button variant={tone} onClick={onConfirm} pending={pending}>
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
