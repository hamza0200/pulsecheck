/**
 * Health endpoints and app-wide plumbing (integration, Supertest + test DB).
 * - GET /health returns ok and an X-Request-Id header
 * - A valid incoming X-Request-Id is echoed back
 * - GET /ready runs SELECT 1 against the database
 * - Unknown routes return the standard { error: { code, message } } shape
 * - Malformed JSON bodies return 400 INVALID_BODY
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('health endpoints', () => {
  it('GET /health returns ok with a request id header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('echoes a valid incoming X-Request-Id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('GET /ready checks the database', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('unknown routes return the standard error shape', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found' },
    });
  });

  it('malformed JSON returns 400 INVALID_BODY', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });
});
