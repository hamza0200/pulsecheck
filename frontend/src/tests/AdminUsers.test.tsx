/**
 * Admin users screen and Account alerts toggle (real routes + providers, fetch faked).
 * - Lists users; the admin's own row has no Disable button
 * - Disabling another user asks for confirmation, then PATCHes { isDisabled: true }
 * - Account: the alerts switch PATCHes alertsEnabled and reflects the new state
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { bodyOf, json, mockApi, renderApp, sessionFor } from './utils';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const users = [
  {
    id: 'u1',
    email: 'ada@example.com',
    role: 'ADMIN',
    isDisabled: false,
    createdAt: '2026-10-01T00:00:00Z',
    monitorCount: 10,
  },
  {
    id: 'u2',
    email: 'bob@example.com',
    role: 'USER',
    isDisabled: false,
    createdAt: '2026-10-02T00:00:00Z',
    monitorCount: 2,
  },
];

describe('AdminUsers', () => {
  it('disables another user after confirmation, never yourself', async () => {
    const fetchSpy = mockApi((path, init) => {
      if (path === '/api/auth/refresh') return json(sessionFor('ADMIN'));
      if (path.startsWith('/api/admin/users?')) return json({ users, nextCursor: null });
      if (path === '/api/admin/users/u2' && init?.method === 'PATCH') {
        return json({ user: { ...users[1], isDisabled: true } });
      }
      return undefined;
    });
    renderApp('/admin/users');

    const myRow = (await screen.findByRole('cell', { name: /ada@example\.com/ })).closest('tr')!;
    expect(within(myRow).queryByRole('button')).not.toBeInTheDocument();

    const bobRow = screen.getByRole('cell', { name: 'bob@example.com' }).closest('tr')!;
    await userEvent.click(within(bobRow).getByRole('button', { name: 'Disable' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disable user' }));

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(bodyOf(patch?.[1])).toEqual({ isDisabled: true });
    });
  });
});

describe('Account alerts', () => {
  it('toggles email alerts', async () => {
    const fetchSpy = mockApi((path, init) => {
      if (path === '/api/auth/refresh') return json(sessionFor());
      const account = {
        id: 'u1',
        email: 'ada@example.com',
        role: 'USER',
        createdAt: '2026-10-01T00:00:00Z',
      };
      if (path === '/api/account' && init?.method === 'PATCH') {
        return json({ account: { ...account, ...(bodyOf(init) as object) } });
      }
      if (path === '/api/account') return json({ account: { ...account, alertsEnabled: true } });
      return undefined;
    });
    renderApp('/account');
    const toggle = await screen.findByRole('switch', { name: 'Email alerts' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByText('Alerts are off.')).toBeInTheDocument();
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(bodyOf(patch?.[1])).toEqual({ alertsEnabled: false });
  });
});
