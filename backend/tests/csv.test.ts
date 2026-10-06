/**
 * CSV export (unit + integration, test DB).
 * - csvField leaves plain values alone and blanks null/undefined
 * - Quotes commas, quotes and newlines (RFC 4180)
 * - Neutralises spreadsheet formulas (CSV injection)
 * - csvRow builds CRLF-terminated rows
 * - export.csv streams headers + escaped rows oldest first, with Content-Type/Content-Disposition
 * - Exports every row across multiple 1,000-row batches
 * - A monitor with no checks exports just the header row
 * - 404 for another user's monitor
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { csvField, csvRow } from '../src/lib/csv.js';
import { prisma } from '../src/lib/prisma.js';
import { type TestSession, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

vi.mock('node:dns/promises', async () => (await import('./helpers/dns.js')).dnsMockModule);

const app = createApp();
let owner: TestSession;
const as = (s: TestSession) => ({ Authorization: `Bearer ${s.accessToken}` });

beforeEach(async () => {
  await resetDb();
  owner = await signupUser(app, 'owner@example.com');
});

describe('csvField', () => {
  it('leaves plain values alone and blanks null/undefined', () => {
    expect(csvField('HTTP 500')).toBe('HTTP 500');
    expect(csvField(200)).toBe('200');
    expect(csvField(true)).toBe('true');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    expect(csvField('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@cmd')).toBe("'@cmd");
  });

  it('builds CRLF-terminated rows', () => {
    expect(csvRow(['a', null, 'b,c'])).toBe('a,,"b,c"\r\n');
  });
});

describe('GET /api/monitors/:id/export.csv', () => {
  async function monitorWithChecks(count: number) {
    const monitor = await prisma.monitor.create({
      data: { userId: owner.user.id, name: 'My Site, Inc.', url: 'https://example.com' },
    });
    const start = Date.UTC(2026, 0, 1);
    await prisma.check.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        monitorId: monitor.id,
        checkedAt: new Date(start + i * 60_000),
        isUp: i % 2 === 0,
        statusCode: i % 2 === 0 ? 200 : 500,
        responseTimeMs: 100 + i,
        error: i % 2 === 0 ? null : 'Bad gateway, "upstream" said no',
      })),
    });
    return monitor;
  }

  it('streams headers and escaped rows, oldest first', async () => {
    const monitor = await monitorWithChecks(3);
    const res = await request(app).get(`/api/monitors/${monitor.id}/export.csv`).set(as(owner));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="My-Site-Inc.-checks-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.text.split('\r\n')).toEqual([
      'checked_at,is_up,status_code,response_time_ms,error',
      '2026-01-01T00:00:00.000Z,true,200,100,',
      '2026-01-01T00:01:00.000Z,false,500,101,"Bad gateway, ""upstream"" said no"',
      '2026-01-01T00:02:00.000Z,true,200,102,',
      '',
    ]);
  });

  it('exports every row across multiple batches', async () => {
    const monitor = await monitorWithChecks(2500);
    const res = await request(app).get(`/api/monitors/${monitor.id}/export.csv`).set(as(owner));
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2501); // header + 2500 rows
    expect(lines[2500]).toMatch(/^2026-01-02T17:39:00.000Z/);
  });

  it('returns only the header for a monitor without checks', async () => {
    const monitor = await monitorWithChecks(0);
    const res = await request(app).get(`/api/monitors/${monitor.id}/export.csv`).set(as(owner));
    expect(res.text).toBe('checked_at,is_up,status_code,response_time_ms,error\r\n');
  });

  it("returns 404 for someone else's monitor", async () => {
    const monitor = await monitorWithChecks(1);
    const other = await signupUser(app, 'other@example.com');
    const res = await request(app).get(`/api/monitors/${monitor.id}/export.csv`).set(as(other));
    expect(res.status).toBe(404);
  });
});
