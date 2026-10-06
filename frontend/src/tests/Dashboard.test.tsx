/**
 * Dashboard (real routes + providers; fetch and EventSource faked).
 * - Empty state with "Add your first monitor" and the usage line
 * - Rows with status badges (word + glyph), down monitors first, summary figures
 * - Live updates: gets a stream ticket, shows "Live", refetches on monitor.checked,
 *   announces monitor.down
 * - Delete asks for confirmation before calling the API
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeEventSource,
  installFakeEventSource,
  json,
  mockApi,
  monitorFixture,
  renderApp,
  sessionFor,
} from './utils';

beforeEach(() => {
  installFakeEventSource();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

function api(
  monitors: unknown[],
  extra?: (path: string, init?: RequestInit) => Response | undefined,
) {
  return mockApi((path, init) => {
    if (path === '/api/auth/refresh') return json(sessionFor());
    if (path === '/api/stream/ticket') return json({ ticket: 't1', expiresInSeconds: 60 }, 201);
    if (path === '/api/monitors' && (init?.method ?? 'GET') === 'GET') {
      return json({ monitors, usage: { used: monitors.length, max: 20 } });
    }
    return extra?.(path, init);
  });
}

describe('Dashboard', () => {
  it('shows the empty state', async () => {
    api([]);
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: 'No monitors yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first monitor' })).toHaveAttribute(
      'href',
      '/monitors/new',
    );
    expect(screen.getByText('0 of 20 monitors used')).toBeInTheDocument();
  });

  it('lists monitors with down ones first and summary figures', async () => {
    api([
      monitorFixture({ id: 'a', name: 'healthy.example' }),
      monitorFixture({
        id: 'b',
        name: 'broken.example',
        currentStatus: 'DOWN',
        lastCheck: {
          checkedAt: new Date().toISOString(),
          isUp: false,
          statusCode: 503,
          responseTimeMs: 90,
          error: 'HTTP 503',
        },
      }),
    ]);
    renderApp('/dashboard');
    const rows = await screen.findAllByRole('row');
    // rows[0] is the header
    expect(within(rows[1]!).getByText('broken.example')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Down')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('HTTP 503')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Up')).toBeInTheDocument();

    const summary = screen.getByText('Down', { selector: 'dt' }).parentElement!;
    expect(within(summary).getByText('1')).toBeInTheDocument();
  });

  it('goes live over SSE and refetches when a check arrives', async () => {
    const fetchSpy = api([monitorFixture()]);
    renderApp('/dashboard');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/stream?ticket=t1');

    source.emit('ready', {});
    expect(await screen.findByText('Live')).toBeInTheDocument();

    const listCalls = () => fetchSpy.mock.calls.filter(([p]) => p === '/api/monitors').length;
    const before = listCalls();
    source.emit('monitor.checked', { monitorId: 'm1' });
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before), { timeout: 2000 });

    source.emit('monitor.down', { name: 'example.com' });
    expect(await screen.findByText('example.com just went down.')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting', async () => {
    const fetchSpy = api([monitorFixture()], (path, init) =>
      path === '/api/monitors/m1' && init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : undefined,
    );
    renderApp('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('heading', { name: 'Delete example.com?' })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Delete monitor' }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });
});
