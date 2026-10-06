/**
 * Log redaction (unit: a real Pino logger with the app's options, writing to memory).
 * - Passwords, tokens, hashes, tickets, cookies and Authorization headers are censored
 *   at the top level and one level deep
 * - redactUrl masks secret query parameters (ticket, token) and leaves others alone
 * - The request serializer keeps only id/method/url/status: no headers, cookies or bodies
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, redactUrl } from '../src/lib/logger.js';
import { requestSerializers } from '../src/middleware/requestId.js';

function memoryLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger(destination, 'info'), lines };
}

describe('log redaction', () => {
  it('censors secrets at the top level and one level deep', () => {
    const { logger, lines } = memoryLogger();
    logger.info(
      {
        password: 'hunter2-hunter2',
        token: 'reset-token-value',
        body: { password: 'nested-secret', currentPassword: 'old', newPassword: 'new' },
        user: { email: 'ada@example.com', passwordHash: '$2b$12$abc' },
        session: { refreshToken: 'r', accessToken: 'a', tokenHash: 'h' },
        stream: { ticket: 't' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'pc_refresh=xyz' } },
      },
      'test',
    );
    const line = lines.join('');
    for (const secret of [
      'hunter2-hunter2',
      'reset-token-value',
      'nested-secret',
      '$2b$12$abc',
      'Bearer abc',
      'pc_refresh=xyz',
    ]) {
      expect(line).not.toContain(secret);
    }
    const parsed = JSON.parse(line) as Record<string, Record<string, unknown>>;
    expect(parsed.user!.email).toBe('ada@example.com'); // non-secrets survive
    expect(parsed.session!.refreshToken).toBe('[REDACTED]');
  });

  it('masks secret query parameters in URLs', () => {
    expect(redactUrl('/api/stream?ticket=abc123')).toBe('/api/stream?ticket=[REDACTED]');
    expect(redactUrl('/reset-password?token=t&x=1')).toBe('/reset-password?token=[REDACTED]&x=1');
    expect(redactUrl('/api/monitors?limit=5&cursor=c')).toBe('/api/monitors?limit=5&cursor=c');
    expect(redactUrl('/api/monitors')).toBe('/api/monitors');
  });
});

describe('request logging', () => {
  it('serializes only id, method, status and a masked url: no headers or bodies', () => {
    const req = {
      id: 'req-1',
      method: 'GET',
      url: '/api/stream?ticket=secret-ticket',
      headers: { authorization: 'Bearer abc', cookie: 'pc_refresh=xyz' },
      body: { password: 'hunter2' },
    };
    expect(requestSerializers.req(req)).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/api/stream?ticket=[REDACTED]',
    });
    expect(
      requestSerializers.res({ statusCode: 200, headers: { 'set-cookie': 'x' } } as never),
    ).toEqual({ statusCode: 200 });
  });
});
