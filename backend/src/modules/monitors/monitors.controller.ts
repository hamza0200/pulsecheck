import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import type {
  CreateMonitorInput,
  ListChecksQuery,
  ListIncidentsQuery,
  MonitorIdParams,
  UpdateMonitorInput,
} from './monitors.schemas.js';
import { monitorsService } from './monitors.service.js';

export const list: RequestHandler = async (req, res) => {
  res.json(await monitorsService.list(currentUser(req).id));
};

export const create: RequestHandler<object, unknown, CreateMonitorInput> = async (req, res) => {
  const monitor = await monitorsService.create(currentUser(req).id, req.body);
  res.status(201).json({ monitor });
};

export const get: RequestHandler<MonitorIdParams> = async (req, res) => {
  res.json({ monitor: await monitorsService.get(currentUser(req).id, req.params.id) });
};

export const update: RequestHandler<MonitorIdParams, unknown, UpdateMonitorInput> = async (
  req,
  res,
) => {
  const monitor = await monitorsService.update(currentUser(req).id, req.params.id, req.body);
  res.json({ monitor });
};

export const remove: RequestHandler<MonitorIdParams> = async (req, res) => {
  await monitorsService.remove(currentUser(req).id, req.params.id);
  res.status(204).end();
};

export const listChecks: RequestHandler<
  MonitorIdParams,
  unknown,
  unknown,
  ListChecksQuery
> = async (req, res) => {
  res.json(await monitorsService.listChecks(currentUser(req).id, req.params.id, req.query));
};

export const listIncidents: RequestHandler<
  MonitorIdParams,
  unknown,
  unknown,
  ListIncidentsQuery
> = async (req, res) => {
  res.json(
    await monitorsService.listIncidents(currentUser(req).id, req.params.id, req.query.limit),
  );
};
