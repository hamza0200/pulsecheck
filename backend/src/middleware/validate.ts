import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Parses (and coerces/normalises) request input with Zod before the controller runs.
 * Controllers can then trust `req.body`, `req.query` and `req.params` and declare their
 * types through Express's RequestHandler generics. A ZodError becomes a 400 in the
 * error handler.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) {
      // Express 5 exposes req.params/req.query through getters; define our own property
      // on the request instance to replace them with the parsed values.
      Object.defineProperty(req, 'params', { value: schemas.params.parse(req.params) });
    }
    if (schemas.query) {
      Object.defineProperty(req, 'query', { value: schemas.query.parse(req.query) });
    }
    if (schemas.body) {
      req.body = schemas.body.parse(req.body ?? {});
    }
    next();
  };
}
