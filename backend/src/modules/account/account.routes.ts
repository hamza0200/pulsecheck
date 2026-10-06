import { Router } from 'express';
import { createRateLimiter } from '../../lib/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './account.controller.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  updateAccountSchema,
} from './account.schemas.js';

// These endpoints verify a password, so they could be used to guess one with a stolen
// access token. Limit them like login.
const passwordCheckLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 10 });

export const accountRouter = Router();

accountRouter.use(requireAuth);
accountRouter.get('/', controller.getAccount);
accountRouter.patch('/', validate({ body: updateAccountSchema }), controller.updateAccount);
accountRouter.delete(
  '/',
  passwordCheckLimiter,
  validate({ body: deleteAccountSchema }),
  controller.deleteAccount,
);
accountRouter.post(
  '/change-password',
  passwordCheckLimiter,
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);
