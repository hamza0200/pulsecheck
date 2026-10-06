import { Router } from 'express';
import { bodyEmail, createRateLimiter } from '../../lib/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from './auth.schemas.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Per IP + email: slows password guessing against one account without locking out
// everyone behind the same NAT.
const loginLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  key: bodyEmail,
  message: 'Too many login attempts, please try again in 15 minutes',
});
const signupLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 20 });
const refreshLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, limit: 100 });
// Each request can send an email, so keep this tight to avoid mail-bombing an address.
const forgotPasswordLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  key: bodyEmail,
  message: 'Too many reset requests, please try again in 15 minutes',
});
const resetPasswordLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, limit: 10 });

export const authRouter = Router();

authRouter.post('/signup', signupLimiter, validate({ body: signupSchema }), controller.signup);
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', refreshLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', requireAuth, controller.me);
authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);
authRouter.post(
  '/reset-password',
  resetPasswordLimiter,
  validate({ body: resetPasswordSchema }),
  controller.resetPassword,
);
