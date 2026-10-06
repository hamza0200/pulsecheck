import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAccount, useChangePassword, useDeleteAccount, useUpdateAlerts } from '../api/account';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Button, FormAlert, TextField } from '../components/forms';
import { ErrorState, Spinner } from '../components/PageState';
import { PasswordStrength } from '../components/PasswordStrength';
import { formatDate } from '../lib/format';
import { validateConfirmation, validateNewPassword } from '../lib/validation';

export function Account() {
  const { data, isPending, isError, refetch } = useAccount();
  if (isPending) return <Spinner label="Loading account" />;
  if (isError) {
    return (
      <ErrorState
        message="Your account details could not be loaded."
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <div className="max-w-xl">
      <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Account</h1>
      <p className="mt-1 text-muted">
        {data.email}, member since {formatDate(data.createdAt)}
      </p>
      <AlertsSetting enabled={data.alertsEnabled} />
      <ChangePassword />
      <DeleteAccount />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <section aria-labelledby={id} className="mt-10 border-t border-grid pt-6">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function AlertsSetting({ enabled }: { enabled: boolean }) {
  const updateAlerts = useUpdateAlerts();
  const { updateUser } = useAuth();
  const value = updateAlerts.isPending ? !enabled : enabled;
  return (
    <Section title="Email alerts">
      <div className="mt-3 flex items-start justify-between gap-6">
        <p id="alerts-description" className="text-muted">
          Email me when one of my sites goes down, comes back up, or has an SSL certificate about to
          expire.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Email alerts"
          aria-describedby="alerts-description"
          disabled={updateAlerts.isPending}
          onClick={() =>
            updateAlerts.mutate(!enabled, {
              onSuccess: (account) => updateUser({ alertsEnabled: account.alertsEnabled }),
            })
          }
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            value ? 'bg-up' : 'bg-unknown'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block size-5 rounded-full bg-surface shadow transition-transform motion-reduce:transition-none ${
              value ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p role="status" className="mt-2 text-sm text-muted">
        {updateAlerts.isError
          ? 'Could not save. Try again.'
          : `Alerts are ${value ? 'on' : 'off'}.`}
      </p>
    </Section>
  );
}

function ChangePassword() {
  const change = useChangePassword();
  const [fields, setFields] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const found = {
      current: fields.current ? undefined : 'Enter your current password',
      next:
        validateNewPassword(fields.next) ??
        (fields.next === fields.current ? 'New password must be different' : undefined),
      confirm: validateConfirmation(fields.next, fields.confirm),
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    try {
      await change.mutateAsync({ currentPassword: fields.current, newPassword: fields.next });
      setFields({ current: '', next: '', confirm: '' });
      setDone(true);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'INVALID_PASSWORD' || err.fieldErrors.currentPassword)
      ) {
        setErrors({ current: err.fieldErrors.currentPassword?.[0] ?? err.message });
      } else if (err instanceof ApiError && err.fieldErrors.newPassword) {
        setErrors({ next: err.fieldErrors.newPassword[0] });
      }
    }
  }

  const otherError =
    change.error instanceof ApiError &&
    !['INVALID_PASSWORD', 'VALIDATION_ERROR'].includes(change.error.code)
      ? change.error.message
      : null;

  return (
    <Section title="Change password">
      <form noValidate onSubmit={handleSubmit} className="mt-4 space-y-5">
        {done && (
          <FormAlert tone="success">
            Password changed. Your other devices have been signed out; this one stays logged in.
          </FormAlert>
        )}
        {otherError && <FormAlert>{otherError}</FormAlert>}
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={fields.current}
          error={errors.current}
          onChange={(e) => setFields({ ...fields, current: e.target.value })}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={fields.next}
          error={errors.next}
          hint={<PasswordStrength password={fields.next} />}
          onChange={(e) => setFields({ ...fields, next: e.target.value })}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={fields.confirm}
          error={errors.confirm}
          onChange={(e) => setFields({ ...fields, confirm: e.target.value })}
        />
        <Button type="submit" pending={change.isPending} pendingLabel="Changing…">
          Change password
        </Button>
      </form>
    </Section>
  );
}

function DeleteAccount() {
  const remove = useDeleteAccount();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError('Enter your password to confirm');
      return;
    }
    setError(undefined);
    setConfirming(true);
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(password);
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <Section title="Delete account">
      <p className="mt-2 text-muted">
        Permanently deletes your account, all your monitors and their history.
      </p>
      <form noValidate onSubmit={handleSubmit} className="mt-4 space-y-5">
        <TextField
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={error}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" variant="danger">
          Delete my account
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        confirmLabel="Delete my account"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void confirmDelete()}
      >
        Your monitors, checks and incidents are deleted immediately. This can&apos;t be undone.
      </ConfirmDialog>
    </Section>
  );
}
