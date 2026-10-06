import { Router } from 'express';
import { createRateLimiter } from '../../lib/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './monitors.controller.js';
import {
  createMonitorSchema,
  listChecksQuerySchema,
  listIncidentsQuerySchema,
  monitorIdParamsSchema,
  updateMonitorSchema,
} from './monitors.schemas.js';

export const monitorsRouter = Router();

const withId = validate({ params: monitorIdParamsSchema });

// Manual checks hit a real website: at most once per minute per user and monitor.
const checkNowLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: 1,
  key: (req) => `${req.user?.id ?? 'anon'}:${String(req.params.id)}`,
  message: 'You can check a monitor manually once per minute',
});

monitorsRouter.use(requireAuth);
monitorsRouter.get('/', controller.list);
monitorsRouter.post('/', validate({ body: createMonitorSchema }), controller.create);
monitorsRouter.get('/:id', withId, controller.get);
monitorsRouter.patch(
  '/:id',
  validate({ params: monitorIdParamsSchema, body: updateMonitorSchema }),
  controller.update,
);
monitorsRouter.delete('/:id', withId, controller.remove);
monitorsRouter.get('/:id/export.csv', withId, controller.exportCsv);
monitorsRouter.post('/:id/check-now', withId, checkNowLimiter, controller.checkNow);
monitorsRouter.get(
  '/:id/checks',
  validate({ params: monitorIdParamsSchema, query: listChecksQuerySchema }),
  controller.listChecks,
);
monitorsRouter.get(
  '/:id/incidents',
  validate({ params: monitorIdParamsSchema, query: listIncidentsQuerySchema }),
  controller.listIncidents,
);
