import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Labelled input with an accessible error and hint (aria-invalid + aria-describedby). */
export function TextField({ label, error, hint, className = '', ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1.5 block w-full rounded-md border bg-surface px-3 py-2 text-base outline-none transition-colors placeholder:text-unknown focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 ${
          error ? 'border-down' : 'border-grid hover:border-muted'
        }`}
        {...input}
      />
      {hint && (
        <div id={hintId} className="mt-1.5 text-sm text-muted">
          {hint}
        </div>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-down">
          {error}
        </p>
      )}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink/90',
  secondary: 'border border-grid bg-surface text-ink hover:border-muted',
  danger: 'bg-down text-white hover:bg-down/90',
  ghost: 'text-ink hover:bg-grid/60',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a busy label and disables the button while a request is pending. */
  pending?: boolean;
  pendingLabel?: string;
}

export function Button({
  variant = 'primary',
  pending = false,
  pendingLabel,
  disabled,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...rest}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

/** A form-level message (server errors, success notices), announced to screen readers. */
export function FormAlert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success';
  children: ReactNode;
}) {
  const styles =
    tone === 'error' ? 'border-down/30 bg-down-soft text-down' : 'border-up/30 bg-up-soft text-ink';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3.5 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
