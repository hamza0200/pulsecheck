import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';
import { logger, redactUrl } from '../lib/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_INCOMING_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reuse a sane incoming X-Request-Id (e.g. from a proxy) or generate one, and echo it
 * back so a user can quote it in a bug report.
 */
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && VALID_INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

// Only what's needed to trace a request: never headers (cookies, tokens) or bodies
// (passwords). Secret query parameters are masked.
export const requestSerializers = {
  req: (req: { id: string; method: string; url: string }) => ({
    id: req.id,
    method: req.method,
    url: redactUrl(req.url),
  }),
  res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
};

// [Node concept: structured logging] pino-http attaches `req.log`, a child logger that
// stamps every line with the request id, so all logs for one request can be correlated.
export const requestLogger = pinoHttp({
  logger,
  genReqId,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Health probes are noisy and uninteresting.
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
  serializers: requestSerializers,
});
