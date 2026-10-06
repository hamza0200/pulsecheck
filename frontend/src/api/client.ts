/**
 * Fetch wrapper for the PulseCheck API.
 *
 * - The access token lives only in this module's memory (never localStorage), so an XSS
 *   bug can't read a stored token. A page reload loses it; the httpOnly refresh cookie
 *   gets a new one.
 * - On a 401, the client refreshes once and retries the request. Concurrent 401s share one
 *   refresh call: refresh tokens rotate, so two parallel refreshes would look like token
 *   theft to the server and end the session.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors from a 400 VALIDATION_ERROR (or SSRF/password errors with details). */
  get fieldErrors(): Record<string, string[]> {
    const details = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return details?.fieldErrors ?? {};
  }
}

export interface SessionUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  alertsEnabled: boolean;
}

export interface Session {
  accessToken: string;
  user: SessionUser;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<Session | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Called when a refresh fails mid-session, so the app can send the user to /login. */
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body.error?.code) {
      return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Not JSON (e.g. the dev proxy can't reach the API).
  }
  return new ApiError(
    res.status,
    res.status >= 500 ? 'SERVER_UNAVAILABLE' : 'UNEXPECTED_RESPONSE',
    res.status >= 500
      ? "Can't reach the PulseCheck server. Check that the API is running."
      : `Unexpected response (${res.status})`,
  );
}

/**
 * Exchanges the refresh cookie for a new session. Resolves null if there is no valid
 * session. All concurrent callers share the same request.
 */
export function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const session = (await res.json()) as Session;
      setAccessToken(session.accessToken);
      return session;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the refresh-and-retry on 401 (for the auth endpoints themselves). */
  skipAuthRetry?: boolean;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { body, skipAuthRetry: _skip, headers, ...rest } = options;
  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');
  if (accessToken) finalHeaders.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`/api${path}`, {
    ...rest,
    credentials: 'same-origin',
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Sends a request and returns the raw Response (used for CSV downloads). */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  let res = await send(path, options);
  if (res.status === 401 && !options.skipAuthRetry) {
    const session = await refreshSession();
    if (!session) {
      onSessionLost?.();
      throw await toApiError(res);
    }
    res = await send(path, options);
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

/** Sends a request and parses the JSON response (undefined for 204). */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
