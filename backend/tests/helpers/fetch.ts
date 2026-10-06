import { vi } from 'vitest';

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Replaces global fetch with a spy driven by `handler`. Undo with vi.unstubAllGlobals(). */
export function mockFetch(handler: FetchHandler) {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input instanceof Request ? input.url : input), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

export const ok = (body = '<html>ok</html>') => new Response(body, { status: 200 });
export const status = (code: number) => new Response(`status ${code}`, { status: code });
export const redirect = (location: string, code = 301) =>
  new Response(null, { status: code, headers: { location } });

export function timeoutError() {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

export function networkError(code = 'ECONNREFUSED') {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(`connect ${code} 93.184.215.14:443`), { code }),
  });
}
