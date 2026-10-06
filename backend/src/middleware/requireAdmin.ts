import type { RequestHandler } from 'express';
import { forbidden } from '../lib/errors.js';
import { currentUser } from './requireAuth.js';

/**
 * Must run after requireAuth. The role comes from the database row requireAuth just
 * loaded, not from the JWT, so a demoted admin loses access on their next request.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (currentUser(req).role !== 'ADMIN') {
    throw forbidden('ADMIN_ONLY', 'Administrator access required');
  }
  next();
};
