import { Router } from 'express';
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
