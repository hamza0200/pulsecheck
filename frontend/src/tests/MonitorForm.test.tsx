/**
 * Monitor form (real routes + providers, fetch faked).
 * - Client-side validation mirrors the backend: URL format/protocol, 5-minute minimum interval
 * - Server SSRF errors (fieldErrors.url) are shown on the URL field
 * - Success navigates to the new monitor's detail page
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, bodyOf, json, mockApi, monitorFixture, renderApp, sessionFor } from './utils';

function api(onCreate: () => Response) {
  return mockApi((path, init) => {
    if (path === '/api/auth/refresh') return json(sessionFor());
    if (path === '/api/monitors' && init?.method === 'POST') return onCreate();
    if (path === '/api/monitors/new-id')
      return json({ monitor: { ...monitorFixture({ id: 'new-id' }), stats: {} } });
    return undefined;
  });
}

describe('MonitorForm', () => {
  it('validates the URL and interval before sending', async () => {
    const fetchSpy = api(() => json({}));
    renderApp('/monitors/new');
    await userEvent.type(await screen.findByLabelText('URL'), 'ftp://example.com');
    const interval = screen.getByLabelText('Check every (minutes)');
    await userEvent.clear(interval);
    await userEvent.type(interval, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Add monitor' }));

    expect(screen.getByText('Only http:// and https:// URLs can be monitored')).toBeInTheDocument();
    expect(screen.getByText('Checks can run at most every 5 minutes')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([p]) => p === '/api/monitors')).toBe(false);
  });

  it('shows the server SSRF error on the URL field', async () => {
    api(() =>
      apiError(400, 'PRIVATE_ADDRESS', 'This URL points to a private address', {
        fieldErrors: { url: ['This URL points to a private address'] },
      }),
    );
    renderApp('/monitors/new');
    await userEvent.type(await screen.findByLabelText('URL'), 'http://internal.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add monitor' }));
    expect(await screen.findByLabelText('URL')).toHaveAccessibleDescription(
      expect.stringContaining('This URL points to a private address'),
    );
  });

  it('creates the monitor and opens its page', async () => {
    const fetchSpy = api(() => json({ monitor: monitorFixture({ id: 'new-id' }) }, 201));
    const { router } = renderApp('/monitors/new');
    await userEvent.type(await screen.findByLabelText('URL'), 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add monitor' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/monitors/new-id'));
    const post = fetchSpy.mock.calls.find(
      ([p, init]) => p === '/api/monitors' && init?.method === 'POST',
    );
    expect(bodyOf(post?.[1])).toEqual({
      url: 'https://example.com',
      intervalMinutes: 10,
      timeoutMs: 10000,
    });
  });
});
