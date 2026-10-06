import type { Request, RequestHandler } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  alertsEnabled: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Verifies the Bearer access token, then loads the user from the database. The lookup
 * (one primary-key query) means disabling or demoting a user takes effect immediately,
 * instead of whenever their 15-minute token happens to expire.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) throw unauthorized('UNAUTHORIZED', 'Missing or expired access token');

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, alertsEnabled: true, isDisabled: true },
  });
  if (!user) throw unauthorized('UNAUTHORIZED', 'Missing or expired access token');
  if (user.isDisabled) throw forbidden('ACCOUNT_DISABLED', 'This account has been disabled');

  req.user = { id: user.id, email: user.email, role: user.role, alertsEnabled: user.alertsEnabled };
  next();
};

/** The authenticated user. Only call from handlers mounted behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
