import { Router } from 'express';
import { requireAdmin } from '../../middleware/requireAdmin.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './admin.controller.js';
import { listUsersQuerySchema, updateUserSchema, userIdParamsSchema } from './admin.schemas.js';

export const adminRouter = Router();

// Order matters: authenticate first (401), then authorise (403).
adminRouter.use(requireAuth, requireAdmin);
adminRouter.get('/stats', controller.stats);
adminRouter.get('/users', validate({ query: listUsersQuerySchema }), controller.listUsers);
adminRouter.patch(
  '/users/:id',
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  controller.updateUser,
);
