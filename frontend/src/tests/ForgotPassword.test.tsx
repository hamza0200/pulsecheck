/**
 * Forgot-password screen (React Testing Library, fetch mocked).
 * - Validates the email before sending
 * - After submitting, always shows "If an account exists…" (no account enumeration)
 * - Server/network errors are shown inline
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, bodyOf, json, mockApi, renderApp } from './utils';

describe('ForgotPassword', () => {
  it('validates the email before sending', async () => {
    const fetchSpy = mockApi();
    renderApp('/forgot-password');
    await userEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter your email address')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.map(([p]) => p)).not.toContain('/api/auth/forgot-password');
  });

  it('shows the same success message whatever the server knows', async () => {
    const fetchSpy = mockApi((path) =>
      path === '/api/auth/forgot-password'
        ? json({ message: "If an account exists for that email, we've sent a link." })
        : undefined,
    );
    renderApp('/forgot-password');
    await userEvent.type(await screen.findByLabelText('Email'), 'maybe@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      "If an account exists for maybe@example.com, we've sent a reset link.",
    );
    const call = fetchSpy.mock.calls.find(([p]) => p === '/api/auth/forgot-password');
    expect(bodyOf(call?.[1])).toEqual({ email: 'maybe@example.com' });
  });

  it('shows a server error inline', async () => {
    mockApi((path) =>
      path === '/api/auth/forgot-password'
        ? apiError(429, 'RATE_LIMITED', 'Too many reset requests, please try again in 15 minutes')
        : undefined,
    );
    renderApp('/forgot-password');
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests');
  });
});
