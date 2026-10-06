import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordStrength } from '../components/PasswordStrength';
import { Button, FormAlert, TextField } from '../components/forms';
import { validateConfirmation, validateEmail, validateNewPassword } from '../lib/validation';

interface Fields {
  email: string;
  password: string;
  confirm: string;
}
type Errors = Partial<Record<keyof Fields, string>>;

function validate(f: Fields): Errors {
  return {
    email: validateEmail(f.email),
    password: validateNewPassword(f.password),
    confirm: validateConfirmation(f.password, f.confirm),
  };
}

export function Signup() {
  const { signup } = useAuth();
  const [fields, setFields] = useState<Fields>({ email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(name: keyof Fields, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    if (submitted) setErrors(validate(next));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const found = validate(fields);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setPending(true);
    try {
      // Logged in on success; GuestRoute then redirects to the dashboard.
      await signup(fields.email.trim(), fields.password);
    } catch (err) {
      if (err instanceof ApiError) {
        // Map server field errors (e.g. EMAIL_TAKEN, VALIDATION_ERROR) onto the form.
        if (err.code === 'EMAIL_TAKEN') setErrors({ email: err.message });
        else if (Object.keys(err.fieldErrors).length > 0) {
          setErrors({
            email: err.fieldErrors.email?.[0],
            password: err.fieldErrors.password?.[0],
          });
        } else setServerError(err.message);
      } else {
        setServerError('Something went wrong. Try again.');
      }
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      intro="Add the sites you care about and get an email when one goes down."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold underline underline-offset-4">
            Log in
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
          value={fields.email}
          error={errors.email}
          onChange={(e) => update('email', e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          value={fields.password}
          error={errors.password}
          hint={<PasswordStrength password={fields.password} />}
          onChange={(e) => update('password', e.target.value)}
        />
        <TextField
          label="Confirm password"
          type="password"
          name="confirm"
          autoComplete="new-password"
          value={fields.confirm}
          error={errors.confirm}
          onChange={(e) => update('confirm', e.target.value)}
        />
        <Button type="submit" pending={pending} pendingLabel="Creating account…" className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
