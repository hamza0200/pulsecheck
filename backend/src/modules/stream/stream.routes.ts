import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { AppError, unauthorized } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { canOpenStream, openStream } from './stream.service.js';
import { TICKET_TTL_MS, consumeTicket, issueTicket } from './tickets.js';

const streamQuerySchema = z.object({ ticket: z.string().min(1).max(200) });
type StreamQuery = z.infer<typeof streamQuerySchema>;

const createTicket: RequestHandler = (req, res) => {
  res.status(201).json({
    ticket: issueTicket(currentUser(req).id),
    expiresInSeconds: TICKET_TTL_MS / 1000,
  });
};

const stream: RequestHandler<Record<string, string>, unknown, unknown, StreamQuery> = async (
  req,
  res,
) => {
  const userId = consumeTicket(req.query.ticket);
  if (!userId) throw unauthorized('INVALID_TICKET', 'Stream ticket is invalid, used or expired');

  // The ticket was issued up to 60s ago; re-check the account is still active.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isDisabled: true },
  });
  if (!user || user.isDisabled) throw unauthorized('INVALID_TICKET', 'Stream ticket is invalid');
  if (!canOpenStream(userId)) {
    throw new AppError(503, 'TOO_MANY_STREAMS', 'Too many open live-update connections');
  }

  openStream(userId, req, res);
};

export const streamRouter = Router();
streamRouter.post('/ticket', requireAuth, createTicket);
streamRouter.get('/', validate({ query: streamQuerySchema }), stream);
