import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env.js';
import { REFRESH_TOKEN_TTL_MS } from '../../lib/tokens.js';

export const REFRESH_COOKIE = 'pc_refresh';

const isLocalhost = ['localhost', '127.0.0.1'].includes(new URL(env.APP_URL).hostname);

const baseOptions: CookieOptions = {
  httpOnly: true, // JavaScript can't read it, so XSS can't steal it.
  sameSite: 'lax', // Not sent on cross-site POSTs, which blocks CSRF against /refresh.
  secure: !isLocalhost, // HTTPS-only everywhere except local development.
  path: '/api/auth', // Only sent to the auth endpoints that need it.
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}

export function readRefreshCookie(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
