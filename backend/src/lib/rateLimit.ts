import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { errorBody } from './errors.js';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Extra key material on top of the client IP (e.g. the email being attacked). */
  key?: (req: Request) => string;
  message?: string;
}

/**
 * Rate limiter with our error shape. Counters are kept in process memory, which is fine
 * for one instance; several instances would need a shared store such as Redis.
 * Disabled in tests unless a test opts in, so suites can create many users quickly.
 */
export function createRateLimiter({ windowMs, limit, key, message }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== 'true',
    keyGenerator: (req) => {
      // ipKeyGenerator groups IPv6 addresses by /56 subnet so one user can't rotate
      // through their whole IPv6 block to dodge the limit.
      const ip = ipKeyGenerator(req.ip ?? 'unknown');
      return key ? `${ip}:${key(req)}` : ip;
    },
    handler: (_req, res, _next, options) => {
      res
        .status(options.statusCode)
        .json(errorBody('RATE_LIMITED', message ?? 'Too many requests, please try again later'));
    },
  });
}

/** Email from a JSON body, normalised, for per-account limits. */
export function bodyEmail(req: Request): string {
  const body: unknown = req.body;
  if (typeof body === 'object' && body !== null && 'email' in body) {
    const email = (body as { email: unknown }).email;
    if (typeof email === 'string') return email.trim().toLowerCase();
  }
  return '';
}
