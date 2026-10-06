/**
 * Sign-up and reset-password forms (React Testing Library, fetch mocked).
 * - Signup mirrors the backend rules: min length, common passwords, matching confirmation
 * - Signup maps 409 EMAIL_TAKEN onto the email field
 * - Successful signup logs in and goes to /dashboard
 * - Reset password: a missing or rejected token shows "request a new link"; success links to login
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, json, mockApi, renderApp, sessionFor } from './utils';

async function fillSignup(email: string, password: string, confirm = password) {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('Signup', () => {
  it('enforces length, common-password and confirmation rules', async () => {
    mockApi();
    renderApp('/signup');
    await fillSignup('ada@example.com', 'short', 'different');
    expect(screen.getByText('Password must be at least 10 characters')).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    expect(screen.getByText('This password is too common, choose another')).toBeInTheDocument();
  });

  it('shows EMAIL_TAKEN on the email field', async () => {
    mockApi((path) =>
      path === '/api/auth/signup'
        ? apiError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
        : undefined,
    );
    renderApp('/signup');
    await fillSignup('taken@example.com', 'correct-horse-battery');
    expect(await screen.findByLabelText('Email')).toHaveAccessibleDescription(
      'An account with this email already exists',
    );
  });

  it('logs in and goes to the dashboard on success', async () => {
    mockApi((path) => (path === '/api/auth/signup' ? json(sessionFor(), 201) : undefined));
    const { router } = renderApp('/signup');
    await fillSignup('ada@example.com', 'correct-horse-battery');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});

describe('ResetPassword', () => {
  it('offers a new link when the token is missing', async () => {
    mockApi();
    renderApp('/reset-password');
    expect(await screen.findByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('offers a new link when the server rejects the token', async () => {
    mockApi((path) =>
      path === '/api/auth/reset-password'
        ? apiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid or has expired.')
        : undefined,
    );
    renderApp('/reset-password?token=expired-token-value-123456');
    await userEvent.type(await screen.findByLabelText('New password'), 'a-brand-new-password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { name: "This link doesn't work" })).toBeVisible();
  });

  it('confirms success and links to login', async () => {
    mockApi((path) => (path === '/api/auth/reset-password' ? json({ message: 'ok' }) : undefined));
    renderApp('/reset-password?token=good-token-value-1234567890');
    await userEvent.type(await screen.findByLabelText('New password'), 'a-brand-new-password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});
