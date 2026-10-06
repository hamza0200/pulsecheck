import { events } from '../../lib/events.js';
import { logger } from '../../lib/logger.js';
import { type MailMessage, mailer } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { downEmail, recoveredEmail, sslExpiringEmail } from './alerts.emails.js';

/**
 * Emails the monitor's owner (never anyone else) if they have alerts enabled.
 * Never throws: alert problems are logged and must not affect the check pipeline.
 */
async function notifyOwner(
  userId: string,
  kind: string,
  build: (email: string) => MailMessage,
): Promise<void> {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, alertsEnabled: true, isDisabled: true },
    });
    if (!owner || owner.isDisabled || !owner.alertsEnabled) return;
    await mailer.send(build(owner.email));
    logger.info({ userId, kind }, 'Alert email sent');
  } catch (err) {
    logger.error({ err, userId, kind }, 'Failed to send alert email');
  }
}

/**
 * Subscribes the email alerts to the event bus. Returns a function that unsubscribes,
 * used by tests (and available for shutdown).
 */
export function registerAlertListeners(): () => void {
  // [Node concept: EventEmitter] emit() is synchronous and ignores listeners' return
  // values. These async listeners therefore run in the background: the runner doesn't
  // wait for SMTP, and notifyOwner catches its own errors so nothing leaks out as an
  // unhandled rejection.
  const onDown = (e: Parameters<typeof downEmail>[1]) =>
    void notifyOwner(e.userId, 'down', (to) => downEmail(to, e));
  const onRecovered = (e: Parameters<typeof recoveredEmail>[1]) =>
    void notifyOwner(e.userId, 'recovered', (to) => recoveredEmail(to, e));
  const onSsl = (e: Parameters<typeof sslExpiringEmail>[1]) =>
    void notifyOwner(e.userId, 'sslExpiring', (to) => sslExpiringEmail(to, e));

  events.on('monitor.down', onDown);
  events.on('monitor.recovered', onRecovered);
  events.on('monitor.sslExpiring', onSsl);

  return () => {
    events.off('monitor.down', onDown);
    events.off('monitor.recovered', onRecovered);
    events.off('monitor.sslExpiring', onSsl);
  };
}
