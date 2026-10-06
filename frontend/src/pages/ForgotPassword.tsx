import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { forgotPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Button, FormAlert, TextField } from '../components/forms';
import { validateEmail } from '../lib/validation';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    const found = validateEmail(email);
    setError(found);
    if (found) return;

    setPending(true);
    try {
      await forgotPassword(email.trim());
      // Same message whether or not the account exists: the server doesn't tell us either.
      setSentTo(email.trim());
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  }

  const backToLogin = (
    <Link to="/login" className="font-semibold underline underline-offset-4">
      Back to log in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={backToLogin}>
        <FormAlert tone="success">
          If an account exists for <strong className="font-semibold">{sentTo}</strong>, we&apos;ve
          sent a reset link. It works once and expires in 30 minutes.
        </FormAlert>
        <p className="mt-4 text-sm text-muted">
          No email after a few minutes? Check spam, or{' '}
          <button
            type="button"
            className="underline underline-offset-4 hover:text-ink"
            onClick={() => setSentTo(null)}
          >
            try a different address
          </button>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter the email you signed up with. We'll send a link to choose a new password."
      footer={backToLogin}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {serverError && <FormAlert>{serverError}</FormAlert>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          error={error}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(validateEmail(e.target.value));
          }}
        />
        <Button type="submit" pending={pending} pendingLabel="Sending…" className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
