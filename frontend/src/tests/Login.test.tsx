/**
 * Login screen (React Testing Library; the real router and AuthProvider, fetch mocked).
 * - Submitting empty shows field errors and sends no request
 * - An invalid email shows an email error; errors clear as the user fixes them
 * - A server error (401 INVALID_CREDENTIALS) is shown inline and the button re-enables
 * - The submit button is disabled while the request is pending
 * - Success navigates to /dashboard
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, bodyOf, json, mockApi, renderApp, sessionFor } from './utils';

async function openLogin() {
  const view = renderApp('/login');
  await screen.findByRole('heading', { name: 'Log in to PulseCheck' });
  return view;
}

describe('Login', () => {
  it('shows field errors and sends nothing when submitted empty', async () => {
    const fetchSpy = mockApi();
    await openLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email address');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchSpy.mock.calls.map(([p]) => p)).not.toContain('/api/auth/login');
  });

  it('validates the email format and clears errors as the user fixes them', async () => {
    mockApi();
    await openLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Email'), '@example.com');
    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
  });

  it('shows the server error inline', async () => {
    mockApi((path) =>
      path === '/api/auth/login'
        ? apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
        : undefined,
    );
    await openLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('disables the button while pending, then goes to the dashboard', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchSpy = mockApi(async (path) => {
      if (path !== '/api/auth/login') return undefined;
      await gate;
      return json(sessionFor());
    });

    const { router } = await openLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'Ada@Example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled();
    release();
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    const loginCall = fetchSpy.mock.calls.find(([p]) => p === '/api/auth/login');
    expect(bodyOf(loginCall?.[1])).toEqual({
      email: 'Ada@Example.com',
      password: 'correct-horse-battery',
    });
  });
});
