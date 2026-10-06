import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { requestLogger } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { accountRouter } from './modules/account/account.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';

/**
 * Builds the Express app without calling listen(), so tests can drive it with Supertest
 * and server.ts owns the process lifecycle.
 */
export function createApp() {
  const app = express();

  // Behind the Vite dev proxy (or a production reverse proxy on the same host),
  // trust X-Forwarded-For from loopback so req.ip is the real client IP for rate limits.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  // [Node concept: Express middleware order] Middleware runs top to bottom for every
  // request: request id + logging first, security headers, body parsing, routes, then the
  // 404 handler, and finally the error handler.
  app.use(requestLogger);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
