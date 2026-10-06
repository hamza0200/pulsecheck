/**
 * Route guards and session restore (real routes + AuthProvider, fetch mocked).
 * - ProtectedRoute: a guest opening /account is redirected to /login
 * - After logging in, the user lands on the page they originally wanted
 * - On load, a valid refresh cookie restores the session without showing /login
 * - GuestRoute: a logged-in user opening /login goes to /dashboard
 * - AdminRoute: a normal user sees "Admins only"; an admin sees the admin page and nav link
 * - Logging out calls the API and returns to /login
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, mockApi, renderApp, sessionFor } from './utils';

describe('ProtectedRoute', () => {
  it('redirects a guest to /login, then back to the original page after login', async () => {
    mockApi((path) => (path === '/api/auth/login' ? json(sessionFor()) : undefined));
    const { router } = renderApp('/account');

    await screen.findByRole('heading', { name: 'Log in to PulseCheck' });
    expect(router.state.location.pathname).toBe('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
  });

  it('restores the session from the refresh cookie on load', async () => {
    mockApi((path) => (path === '/api/auth/refresh' ? json(sessionFor()) : undefined));
    const { router } = renderApp('/dashboard');
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard');
  });
});

describe('GuestRoute', () => {
  it('sends a logged-in user from /login to /dashboard', async () => {
    mockApi((path) => (path === '/api/auth/refresh' ? json(sessionFor()) : undefined));
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});

describe('AdminRoute', () => {
  it('shows "Admins only" to a normal user and hides the Admin link', async () => {
    mockApi((path) => (path === '/api/auth/refresh' ? json(sessionFor('USER')) : undefined));
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Admins only' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('lets an admin in and shows the Admin link', async () => {
    mockApi((path) => (path === '/api/auth/refresh' ? json(sessionFor('ADMIN')) : undefined));
    renderApp('/admin');
    expect(await screen.findByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admins only' })).not.toBeInTheDocument();
  });
});

describe('Log out', () => {
  it('calls the API and returns to /login', async () => {
    const fetchSpy = mockApi((path) => {
      if (path === '/api/auth/refresh') return json(sessionFor());
      if (path === '/api/auth/logout') return new Response(null, { status: 204 });
      return undefined;
    });
    const { router } = renderApp('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(fetchSpy.mock.calls.map(([p]) => p)).toContain('/api/auth/logout');
  });
});
