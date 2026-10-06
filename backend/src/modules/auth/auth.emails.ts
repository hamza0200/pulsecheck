import { env } from '../../config/env.js';
import { type MailMessage, escapeHtml } from '../../lib/mailer.js';

export function passwordResetEmail(to: string, token: string, ttlMinutes: number): MailMessage {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your PulseCheck password',
    text: [
      'Someone (hopefully you) asked to reset the password for your PulseCheck account.',
      '',
      `Open this link to choose a new password. It works once and expires in ${ttlMinutes} minutes:`,
      link,
      '',
      "If you didn't ask for this, you can ignore this email; your password won't change.",
    ].join('\n'),
    html: `
      <p>Someone (hopefully you) asked to reset the password for your PulseCheck account.</p>
      <p><a href="${escapeHtml(link)}">Choose a new password</a></p>
      <p>The link works once and expires in ${ttlMinutes} minutes.</p>
      <p>If you didn't ask for this, you can ignore this email; your password won't change.</p>
    `,
  };
}
