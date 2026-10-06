/**
 * Rate limits not covered elsewhere (integration; limits switched on for this file).
 * - Global API ceiling: the 301st /api request in a minute from one IP gets 429
 * - Forgot password: 5 per 15 minutes per IP + email
 * - Reset password: 10 per 15 minutes per IP
 * - 429 responses use the standard error shape and send RateLimit headers
 * (Login and check-now limits are tested in auth.test.ts and runner.test.ts.)
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

beforeAll(() => {
  process.env.RATE_LIMIT_IN_TESTS = 'true';
});
afterAll(() => {
  delete process.env.RATE_LIMIT_IN_TESTS;
});

describe('rate limits', () => {
  it('caps any client at 300 API requests per minute', async () => {
    const app = createApp();
    for (let i = 0; i < 300; i++) {
      expect((await request(app).get('/api/nope')).status).toBe(404);
    }
    const blocked = await request(app).get('/api/nope');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers).toHaveProperty('ratelimit');
    // Health checks are outside /api and never limited.
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('limits forgot-password to 5 per 15 minutes per email', async () => {
    const app = createApp();
    const send = () =>
      request(app).post('/api/auth/forgot-password').send({ email: 'target@example.com' });
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it('limits reset-password to 10 per 15 minutes', async () => {
    const app = createApp();
    const send = () =>
      request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'x'.repeat(43), password: 'a-new-password-1' });
    for (let i = 0; i < 10; i++) expect((await send()).status).toBe(400);
    expect((await send()).status).toBe(429);
  });
});
