/**
 * API client (unit, fetch mocked).
 * - Sends the in-memory access token as a Bearer header
 * - On 401: refreshes once, then retries the original request with the new token
 * - Concurrent 401s share a single refresh request (rotating tokens must not race)
 * - If the refresh fails, the session-lost handler runs and the ApiError surfaces
 * - Error bodies become ApiError with status, code, message and field errors
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setAccessToken, setSessionLostHandler } from '../api/client';
import { apiError, json, sessionFor } from './utils';

afterEach(() => {
  setAccessToken(null);
  setSessionLostHandler(null);
});

function stubFetch(impl: (path: string, headers: Headers) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), new Headers(init?.headers)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('api client', () => {
  it('sends the access token as a Bearer header', async () => {
    setAccessToken('abc');
    const spy = stubFetch(() => json({ ok: true }));
    await api('/monitors');
    expect(new Headers(spy.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer abc');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('expired');
    const spy = stubFetch((path, headers) => {
      if (path === '/api/auth/refresh') return json(sessionFor());
      return headers.get('authorization') === 'Bearer test-access-token'
        ? json({ monitors: [] })
        : apiError(401, 'UNAUTHORIZED', 'Expired');
    });
    await expect(api('/monitors')).resolves.toEqual({ monitors: [] });
    expect(spy.mock.calls.map(([p]) => p)).toEqual([
      '/api/monitors',
      '/api/auth/refresh',
      '/api/monitors',
    ]);
  });

  it('shares one refresh between concurrent 401s', async () => {
    setAccessToken('expired');
    const spy = stubFetch(async (path, headers) => {
      if (path === '/api/auth/refresh') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(sessionFor());
      }
      return headers.get('authorization') === 'Bearer test-access-token'
        ? json({ ok: path })
        : apiError(401, 'UNAUTHORIZED', 'Expired');
    });
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(spy.mock.calls.filter(([p]) => p === '/api/auth/refresh')).toHaveLength(1);
  });

  it('calls the session-lost handler when the refresh fails', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    stubFetch(() => apiError(401, 'UNAUTHORIZED', 'Expired'));
    await expect(api('/monitors')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(lost).toHaveBeenCalledOnce();
  });

  it('turns error bodies into ApiError with field errors', async () => {
    stubFetch(() =>
      apiError(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fieldErrors: { url: ['Enter a valid URL'] },
      }),
    );
    const error = await api('/monitors', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual({ url: ['Enter a valid URL'] });
  });
});
