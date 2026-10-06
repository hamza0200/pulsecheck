import { env } from '../../config/env.js';
import type {
  MonitorDownEvent,
  MonitorRecoveredEvent,
  MonitorSslExpiringEvent,
} from '../../lib/events.js';
import { type MailMessage, escapeHtml } from '../../lib/mailer.js';

const monitorLink = (monitorId: string) => `${env.APP_URL}/monitors/${monitorId}`;
const footer = `You get these emails because alerts are on for your PulseCheck account. Turn them off at ${env.APP_URL}/account`;

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ''}`;
}

function build(to: string, subject: string, lines: string[], link: string): MailMessage {
  return {
    to,
    subject,
    text: [...lines, '', `Details: ${link}`, '', footer].join('\n'),
    html: `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}
      <p><a href="${escapeHtml(link)}">View monitor</a></p>
      <p style="color:#64748b;font-size:12px">${escapeHtml(footer)}</p>`,
  };
}

export function downEmail(to: string, e: MonitorDownEvent): MailMessage {
  return build(
    to,
    `🔴 DOWN: ${e.name}`,
    [
      `${e.name} (${e.url}) is DOWN.`,
      `Reason: ${e.cause}`,
      `Detected at ${e.startedAt.toUTCString()} after 2 consecutive failed checks.`,
    ],
    monitorLink(e.monitorId),
  );
}

export function recoveredEmail(to: string, e: MonitorRecoveredEvent): MailMessage {
  const downtime = e.downSince
    ? ` It was down for about ${formatDuration(e.recoveredAt.getTime() - e.downSince.getTime())}.`
    : '';
  return build(
    to,
    `🟢 RECOVERED: ${e.name}`,
    [`${e.name} (${e.url}) is back UP.${downtime}`, `Recovered at ${e.recoveredAt.toUTCString()}.`],
    monitorLink(e.monitorId),
  );
}

export function sslExpiringEmail(to: string, e: MonitorSslExpiringEvent): MailMessage {
  const when =
    e.daysLeft < 0
      ? `expired on ${e.expiresAt.toUTCString()}`
      : `expires in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'} (${e.expiresAt.toUTCString()})`;
  return build(
    to,
    e.daysLeft < 0
      ? `⚠️ SSL certificate expired: ${e.name}`
      : `⚠️ SSL certificate expiring: ${e.name}`,
    [
      `The SSL certificate for ${e.name} (${e.url}) ${when}.`,
      'Renew it to avoid browser warnings.',
    ],
    monitorLink(e.monitorId),
  );
}
