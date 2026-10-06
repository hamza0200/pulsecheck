import type { Request, RequestHandler } from 'express';
import type { ZodType, z } from 'zod';

type ParamsOf<S> = S extends ZodType ? z.output<S> : Request['params'];
type BodyOf<S> = S extends ZodType ? z.output<S> : unknown;
type QueryOf<S> = S extends ZodType ? z.output<S> : Request['query'];

/**
 * Parses (and coerces/normalises) request input with Zod before the controller runs.
 * The returned handler is typed with the schemas' output types, so a route like
 * `router.get('/:id', validate({ params }), controller.get)` type-checks that the
 * controller expects exactly what was validated. A ZodError becomes a 400 in the error
 * handler.
 */
export function validate<
  P extends ZodType | undefined = undefined,
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
>(schemas: {
  params?: P;
  body?: B;
  query?: Q;
}): RequestHandler<ParamsOf<P>, unknown, BodyOf<B>, QueryOf<Q>> {
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
      req.body = schemas.body.parse(req.body ?? {}) as BodyOf<B>;
    }
    next();
  };
}
