import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_BODY_BYTES,
  USER_AGENT,
  performCheck,
  readBodyPrefix,
} from '../src/modules/checks/checker.js';
import { mockFetch, networkError, ok, redirect, status, timeoutError } from './helpers/fetch.js';

vi.mock('node:dns/promises', async () => (await import('./helpers/dns.js')).dnsMockModule);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performCheck', () => {
  it('200 is up, with status, timing and a polite GET request', async () => {
    const fetchSpy = mockFetch(() => ok());
    const result = await performCheck('https://example.com', 5000);

    expect(result).toMatchObject({ isUp: true, statusCode: 200, error: null });
    expect(result.responseTimeMs).toEqual(expect.any(Number));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://example.com');
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows 301 -> 200 and reports up', async () => {
    const fetchSpy = mockFetch((url) => (url === 'https://example.com' ? redirect('/home') : ok()));
    const result = await performCheck('https://example.com', 5000);
    expect(result).toMatchObject({
      isUp: true,
      statusCode: 200,
      finalUrl: 'https://example.com/home',
    });
    expect(fetchSpy.mock.calls.map(([u]) => u)).toEqual([
      'https://example.com',
      'https://example.com/home',
    ]);
  });

  it('500 is down and is not retried (the server answered)', async () => {
    const fetchSpy = mockFetch(() => status(500));
    const result = await performCheck('https://example.com', 5000);
    expect(result).toMatchObject({ isUp: false, statusCode: 500, error: 'HTTP 500' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('404 is down; 304 without Location is up', async () => {
    mockFetch(() => status(404));
    expect((await performCheck('https://example.com', 5000)).isUp).toBe(false);
    mockFetch(() => new Response(null, { status: 304 }));
    expect((await performCheck('https://example.com', 5000)).isUp).toBe(true);
  });

  it('a timeout is retried once, then recorded as down', async () => {
    const fetchSpy = mockFetch(() => {
      throw timeoutError();
    });
    const result = await performCheck('https://example.com', 3000);
    expect(result).toMatchObject({
      isUp: false,
      statusCode: null,
      responseTimeMs: null,
      error: 'Timed out after 3000 ms',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a network error followed by success counts as up', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls === 1) throw networkError('ECONNRESET');
      return ok();
    });
    expect((await performCheck('https://example.com', 5000)).isUp).toBe(true);
  });

  it('describes network errors using the underlying code', async () => {
    mockFetch(() => {
      throw networkError('ECONNREFUSED');
    });
    const result = await performCheck('https://example.com', 5000);
    expect(result.error).toMatch(/^ECONNREFUSED/);
  });

  it('blocks a private target before any request is made', async () => {
    const fetchSpy = mockFetch(() => ok());
    const result = await performCheck('http://internal.example', 5000);
    expect(result.isUp).toBe(false);
    expect(result.error).toMatch(/^Blocked/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks a redirect to a private IP and does not follow it', async () => {
    const fetchSpy = mockFetch(() => redirect('http://169.254.169.254/latest/meta-data/'));
    const result = await performCheck('https://example.com', 5000);
    expect(result.isUp).toBe(false);
    expect(result.error).toMatch(/Blocked redirect to http:\/\/169\.254\.169\.254/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry for a permanent block
  });

  it('gives up after 5 redirects', async () => {
    let n = 0;
    const fetchSpy = mockFetch(() => redirect(`https://example.com/hop-${++n}`));
    const result = await performCheck('https://example.com', 5000);
    expect(result).toMatchObject({ isUp: false, error: 'Too many redirects (more than 5)' });
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});

describe('readBodyPrefix', () => {
  it('reads at most 64 KB, then cancels the stream', async () => {
    const chunk = new Uint8Array(16 * 1024);
    let pulls = 0;
    const cancel = vi.fn();
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
      cancel,
    });

    const bytes = await readBodyPrefix(endless);
    expect(bytes).toBe(MAX_BODY_BYTES);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThan(10); // stopped early instead of reading forever
  });

  it('handles short and empty bodies', async () => {
    expect(await readBodyPrefix(new Response('hello').body)).toBe(5);
    expect(await readBodyPrefix(null)).toBe(0);
  });
});
