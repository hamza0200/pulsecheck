import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// [Node concept: email over SMTP] One pooled SMTP transport per process. Locally it points
// at Mailpit, which accepts everything and shows it at http://localhost:8025; in
// production the same code talks to a real SMTP provider.
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  pool: true,
  ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
  connectionTimeout: 10_000,
});

/**
 * The only way the app sends email. Tests replace `send` with a spy, so no test ever
 * needs an SMTP server.
 */
export const mailer = {
  async send(message: MailMessage): Promise<void> {
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
    logger.info({ to: message.to, subject: message.subject }, 'Email sent');
  },

  /** Sends without waiting; failures are logged, never thrown at the caller. */
  sendInBackground(message: MailMessage): void {
    mailer.send(message).catch((err: unknown) => {
      logger.error({ err, to: message.to, subject: message.subject }, 'Failed to send email');
    });
  },

  close(): void {
    transport.close();
  },
};

/** Minimal HTML escaping for values interpolated into email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
