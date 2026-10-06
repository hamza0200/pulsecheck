import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { routes } from '../App';
import { setAccessToken } from '../api/client';
import { AuthProvider } from '../auth/AuthProvider';
import { createQueryClient } from '../queryClient';

export type Handler = (
  path: string,
  init: RequestInit | undefined,
) => Response | undefined | Promise<Response | undefined>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, ...(details ? { details } : {}) } }, status);

export const sessionFor = (role: 'USER' | 'ADMIN' = 'USER') => ({
  accessToken: 'test-access-token',
  user: { id: 'u1', email: 'ada@example.com', role, alertsEnabled: true },
});

/**
 * Replaces fetch. `handler` returns a Response for the paths it knows. Anything else gets
 * a 404 so a missing mock fails loudly. /api/auth/refresh defaults to "no session".
 */
export function mockApi(handler: Handler = () => undefined) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const res = await handler(path, init);
    if (res) return res;
    if (path === '/api/auth/refresh') return apiError(401, 'INVALID_REFRESH_TOKEN', 'No session');
    return apiError(404, 'NOT_FOUND', `Unmocked ${init?.method ?? 'GET'} ${path}`);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function bodyOf(init: RequestInit | undefined): unknown {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

/** Renders the real app routes at `path` inside the real providers. */
export function renderApp(path: string) {
  setAccessToken(null);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, ...utils };
}
