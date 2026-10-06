import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, z } from 'zod';
import { AppError, errorBody } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}

// [Node concept: Express middleware] An error handler is recognised by its four
// arguments and must be registered last. In Express 5, a rejected promise from an async
// handler is forwarded here automatically — no try/catch or asyncHandler wrapper needed.
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (res.headersSent) {
    // Streaming responses (CSV, SSE) can fail mid-way; all we can do is end the socket.
    req.log?.error({ err }, 'Error after headers were sent');
    res.end();
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json(errorBody(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    res
      .status(400)
      .json(errorBody('VALIDATION_ERROR', 'Request validation failed', z.flattenError(err)));
    return;
  }

  if (isBodyParserError(err) && err.status < 500) {
    const code = err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY';
    res.status(err.status).json(errorBody(code, 'The request body could not be parsed'));
    return;
  }

  (req.log ?? logger).error({ err }, 'Unhandled error');
  res.status(500).json(errorBody('INTERNAL_ERROR', 'Something went wrong'));
};
