import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../components/AuthLayout';
import { Button, FormAlert, TextField } from '../components/forms';
import { validateEmail } from '../lib/validation';

interface Errors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): Errors {
  return {
    email: validateEmail(email),
    password: password ? undefined : 'Enter your password',
  };
}

export function Login() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const found = validate(email, password);
    setErrors(found);
    if (found.email || found.password) return;

    setPending(true);
    try {
      // On success the auth state changes and GuestRoute redirects to where the user was going.
      await login(email.trim(), password);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setPending(false);
    }
  }

  // After the first submit, re-validate as the user types so errors clear as they fix them.
  const revalidate = (nextEmail: string, nextPassword: string) => {
    if (submitted) setErrors(validate(nextEmail, nextPassword));
  };

  return (
    <AuthLayout
      title="Log in to PulseCheck"
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-semibold underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {serverError && <FormAlert>{serverError}</FormAlert>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            revalidate(e.target.value, password);
          }}
        />
        <div>
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            error={errors.password}
            onChange={(e) => {
              setPassword(e.target.value);
              revalidate(email, e.target.value);
            }}
          />
          <Link
            to="/forgot-password"
            className="mt-2 inline-block text-sm text-muted underline underline-offset-4 hover:text-ink"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" pending={pending} pendingLabel="Logging in…" className="w-full">
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
