import { env } from '../../config/env.js';
import { retry } from '../../lib/retry.js';
import { SsrfError, assertPublicUrl } from '../../lib/ssrf-guard.js';

export const USER_AGENT = 'PulseCheck/1.0 (local uptime monitor)';
export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 64 * 1024;
const RETRY_BASE_DELAY_MS = env.NODE_ENV === 'test' ? 5 : 1000;

export interface CheckResult {
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  /** URL of the final response after redirects. */
  finalUrl: string;
}

/** A failure worth retrying once: timeouts and network-level errors. */
class TransientCheckError extends Error {
  constructor(
    message: string,
    public readonly finalUrl: string,
  ) {
    super(message);
  }
}

/** A failure that a retry won't fix: blocked URL, too many redirects. */
class PermanentCheckError extends Error {
  constructor(
    message: string,
    public readonly finalUrl: string,
  ) {
    super(message);
  }
}

/**
 * Reads at most `maxBytes` of a response body, then cancels the stream.
 *
 * [Node concept: streams] The body is a web ReadableStream. Reading chunk by chunk and
 * stopping early means a 50 MB page costs us 64 KB of bandwidth and memory. cancel() tells
 * the underlying socket we're done, so the server stops sending and the connection is
 * released instead of buffering the rest.
 */
export async function readBodyPrefix(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = MAX_BODY_BYTES,
): Promise<number> {
  if (!body) return 0;
  const reader = body.getReader();
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return total;
}

/** Turns fetch's opaque "fetch failed" into something a human can act on. */
function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `Timed out after ${timeoutMs} ms`;
  }
  if (err instanceof Error) {
    const cause = err.cause as { code?: unknown; message?: unknown } | undefined;
    if (cause && typeof cause.code === 'string') {
      const detail = typeof cause.message === 'string' ? cause.message : '';
      return `${cause.code}${detail ? `: ${detail}` : ''}`;
    }
    return err.message;
  }
  return String(err);
}

/** One attempt: up to MAX_REDIRECTS hops, each validated by the SSRF guard. */
async function attemptCheck(url: string, timeoutMs: number): Promise<CheckResult> {
  // [Node concept: timeouts and cancellation] One AbortSignal covers the whole attempt,
  // including every redirect hop and the body read. When it fires, fetch rejects and the
  // socket is torn down. No manual clearTimeout bookkeeping is needed.
  const signal = AbortSignal.timeout(timeoutMs);
  // [Node concept: timing] performance.now() is monotonic and sub-millisecond, unlike
  // Date.now(), which can jump when the system clock is adjusted.
  const started = performance.now();
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertPublicUrl(current);
    } catch (err) {
      if (err instanceof SsrfError) {
        throw new PermanentCheckError(
          hop === 0 ? `Blocked: ${err.message}` : `Blocked redirect to ${current}: ${err.message}`,
          current,
        );
      }
      throw err;
    }

    let response: Response;
    try {
      response = await fetch(current, {
        method: 'GET',
        // Follow redirects ourselves so each hop goes through the SSRF guard.
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
      });
    } catch (err) {
      throw new TransientCheckError(describeFetchError(err, timeoutMs), current);
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, current).href;
      continue;
    }

    // Response time = time until the final response's headers arrived.
    const responseTimeMs = Math.round(performance.now() - started);
    try {
      await readBodyPrefix(response.body);
    } catch {
      // A body that breaks mid-way doesn't change the verdict: the server answered.
    }
    // 2xx and 3xx (e.g. 304, or a redirect with no Location) are up; 4xx/5xx are down.
    const isUp = response.status >= 200 && response.status < 400;
    return {
      isUp,
      statusCode: response.status,
      responseTimeMs,
      error: isUp ? null : `HTTP ${response.status}`,
      finalUrl: current,
    };
  }
  throw new PermanentCheckError(`Too many redirects (more than ${MAX_REDIRECTS})`, current);
}

/**
 * Checks a URL. Never throws: every outcome becomes a CheckResult. Network errors and
 * timeouts are retried once with backoff before being recorded as down. HTTP error statuses
 * aren't retried, because the server answered clearly.
 */
export async function performCheck(url: string, timeoutMs: number): Promise<CheckResult> {
  try {
    return await retry(() => attemptCheck(url, timeoutMs), {
      retries: 1,
      baseDelayMs: RETRY_BASE_DELAY_MS,
      shouldRetry: (err) => err instanceof TransientCheckError,
    });
  } catch (err) {
    const known = err instanceof TransientCheckError || err instanceof PermanentCheckError;
    return {
      isUp: false,
      statusCode: null,
      responseTimeMs: null,
      error: err instanceof Error ? err.message : String(err),
      finalUrl: known ? err.finalUrl : url,
    };
  }
}
