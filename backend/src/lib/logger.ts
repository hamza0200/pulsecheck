import { type DestinationStream, type LoggerOptions, pino } from 'pino';
import { env } from '../config/env.js';

/** Query-string parameters that carry secrets (SSE tickets, reset tokens). */
const SECRET_QUERY_PARAMS = ['ticket', 'token', 'password', 'access_token'];

/** Masks secret query parameters in a URL path, e.g. /api/stream?ticket=[REDACTED]. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  for (const key of SECRET_QUERY_PARAMS) {
    if (params.has(key)) params.set(key, '[REDACTED]');
  }
  return `${url.slice(0, queryStart)}?${params.toString().replaceAll('%5BREDACTED%5D', '[REDACTED]')}`;
}

// [Node concept: structured logging] Pino writes one JSON object per line, which log
// platforms can index. Redaction removes secrets before they ever reach stdout: paths are
// compiled once into fast accessors, so it costs almost nothing per line.
export const redactOptions: LoggerOptions['redact'] = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'password',
    'currentPassword',
    'newPassword',
    'passwordHash',
    'token',
    'refreshToken',
    'accessToken',
    'ticket',
    '*.password',
    '*.currentPassword',
    '*.newPassword',
    '*.passwordHash',
    '*.token',
    '*.tokenHash',
    '*.refreshToken',
    '*.accessToken',
    '*.ticket',
    '*.authorization',
    '*.cookie',
  ],
  censor: '[REDACTED]',
};

/** Builds a logger with the app's redaction rules (tests pass their own destination). */
export function createLogger(destination?: DestinationStream, level: string = env.LOG_LEVEL) {
  const options: LoggerOptions = { level, redact: redactOptions };
  if (destination) return pino(options, destination);
  if (env.NODE_ENV === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(options);
}

export const logger = createLogger(undefined, env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL);

export type Logger = typeof logger;
