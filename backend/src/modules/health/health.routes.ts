import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { errorBody } from '../../lib/errors.js';

export const healthRouter = Router();

// Liveness: is the process up and its event loop responsive? Never touches dependencies,
// so a slow database doesn't make an orchestrator restart a healthy process.
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// Readiness: can this instance serve traffic right now? Checks the database.
healthRouter.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (err) {
    req.log.warn({ err }, 'Readiness check failed');
    res.status(503).json(errorBody('NOT_READY', 'Database is not reachable'));
  }
});
