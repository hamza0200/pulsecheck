import { pipeline } from 'node:stream/promises';
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

export const checkNow: RequestHandler<MonitorIdParams> = async (req, res) => {
  res.json(await monitorsService.checkNow(currentUser(req).id, req.params.id));
};

export const exportCsv: RequestHandler<MonitorIdParams> = async (req, res) => {
  const { filename, rows, toCsv } = await monitorsService.exportChecksCsv(
    currentUser(req).id,
    req.params.id,
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  // [Node concept: streams] pipeline() wires rows -> CSV transform -> response with
  // backpressure: when the client reads slowly, res.write() signals "full" and pipeline
  // pauses the source until 'drain'. If any stage fails or the client disconnects, it
  // destroys every stage, so the generator stops fetching batches.
  try {
    await pipeline(rows, toCsv, res);
  } catch (err) {
    // The client went away mid-download: nothing to report.
    if ((err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    throw err;
  }
};
