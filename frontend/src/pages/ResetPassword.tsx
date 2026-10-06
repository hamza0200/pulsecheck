import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordStrength } from '../components/PasswordStrength';
import { Button, FormAlert, TextField } from '../components/forms';
import { validateConfirmation, validateNewPassword } from '../lib/validation';

type Status = 'form' | 'done' | 'invalid-token';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(token ? 'form' : 'invalid-token');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    const found = {
      password: validateNewPassword(password),
      confirm: validateConfirmation(password, confirm),
    };
    setErrors(found);
    if (found.password || found.confirm) return;

    setPending(true);
    try {
      await resetPassword(token, password);
      setStatus('done');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_OR_EXPIRED_TOKEN') {
        setStatus('invalid-token');
      } else if (err instanceof ApiError && err.fieldErrors.password) {
        setErrors({ password: err.fieldErrors.password[0] });
      } else {
        setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setPending(false);
    }
  }

  if (status === 'invalid-token') {
    return (
      <AuthLayout title="This link doesn't work">
        <p className="text-muted">
          Reset links work once and expire after 30 minutes. This one is invalid, already used, or
          expired.
        </p>
        <Link
          to="/forgot-password"
          className="mt-6 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink/90"
        >
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  if (status === 'done') {
    return (
      <AuthLayout title="Password changed">
        <FormAlert tone="success">
          Your new password is set. For safety, every device that was logged in has been signed out.
        </FormAlert>
        <Link
          to="/login"
          className="mt-6 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink/90"
        >
          Log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {serverError && <FormAlert>{serverError}</FormAlert>}
        <TextField
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          hint={<PasswordStrength password={password} />}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label="Confirm new password"
          type="password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" pending={pending} pendingLabel="Saving…" className="w-full">
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}
