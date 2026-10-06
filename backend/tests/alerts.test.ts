/**
 * Alert emails driven by the event bus (integration, test DB, mailer mocked).
 * - monitor.down emails the monitor's owner with the cause
 * - monitor.recovered emails the owner with the downtime duration
 * - monitor.sslExpiring emails about expiring and already-expired certificates
 * - Nothing is sent when the owner turned alerts off
 * - An SMTP failure is logged and never thrown back into the emitter
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { events } from '../src/lib/events.js';
import { prisma } from '../src/lib/prisma.js';
import { registerAlertListeners } from '../src/modules/alerts/alerts.service.js';
import { type TestSession, signupUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { mockMailer, sentMessages } from './helpers/mail.js';

const app = createApp();
let unregister: () => void;
let owner: TestSession;
let mailSpy: ReturnType<typeof mockMailer>;

const ref = () => ({
  userId: owner.user.id,
  monitorId: '00000000-0000-4000-8000-000000000001',
  name: 'example.com',
  url: 'https://example.com',
});

beforeAll(() => {
  unregister = registerAlertListeners();
});
afterAll(() => unregister());
beforeEach(async () => {
  await resetDb();
  owner = await signupUser(app, 'owner@example.com');
  mailSpy = mockMailer();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('alert emails', () => {
  it('emails the monitor owner when a site goes down', async () => {
    events.emit('monitor.down', { ...ref(), cause: 'HTTP 503', startedAt: new Date() });
    await vi.waitFor(() => expect(mailSpy).toHaveBeenCalledOnce());
    const [message] = sentMessages(mailSpy);
    expect(message).toMatchObject({ to: 'owner@example.com', subject: '🔴 DOWN: example.com' });
    expect(message!.text).toContain('Reason: HTTP 503');
    expect(message!.text).toContain('http://localhost:5173/monitors/');
  });

  it('emails on recovery with the downtime duration', async () => {
    const recoveredAt = new Date();
    events.emit('monitor.recovered', {
      ...ref(),
      downSince: new Date(recoveredAt.getTime() - 25 * 60_000),
      recoveredAt,
    });
    await vi.waitFor(() => expect(mailSpy).toHaveBeenCalledOnce());
    const [message] = sentMessages(mailSpy);
    expect(message!.subject).toBe('🟢 RECOVERED: example.com');
    expect(message!.text).toContain('down for about 25 minutes');
  });

  it('emails about expiring and expired SSL certificates', async () => {
    events.emit('monitor.sslExpiring', {
      ...ref(),
      expiresAt: new Date(Date.now() + 5 * 86_400_000),
      daysLeft: 5,
    });
    events.emit('monitor.sslExpiring', {
      ...ref(),
      expiresAt: new Date(Date.now() - 86_400_000),
      daysLeft: -1,
    });
    await vi.waitFor(() => expect(mailSpy).toHaveBeenCalledTimes(2));
    const subjects = sentMessages(mailSpy).map((m) => m.subject);
    expect(subjects).toContain('⚠️ SSL certificate expiring: example.com');
    expect(subjects).toContain('⚠️ SSL certificate expired: example.com');
  });

  it('sends nothing when the owner turned alerts off', async () => {
    await prisma.user.update({ where: { id: owner.user.id }, data: { alertsEnabled: false } });
    events.emit('monitor.down', { ...ref(), cause: 'HTTP 503', startedAt: new Date() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('an SMTP failure is logged, never thrown into the emitter', async () => {
    mailSpy.mockRejectedValue(new Error('SMTP down'));
    expect(() =>
      events.emit('monitor.down', { ...ref(), cause: 'HTTP 503', startedAt: new Date() }),
    ).not.toThrow();
    await vi.waitFor(() => expect(mailSpy).toHaveBeenCalledOnce());
  });
});
