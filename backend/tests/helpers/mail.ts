import { vi } from 'vitest';
import { type MailMessage, mailer } from '../../src/lib/mailer.js';

/** Replaces real SMTP sending with a spy that records every message. */
export function mockMailer() {
  return vi.spyOn(mailer, 'send').mockResolvedValue(undefined);
}

export function sentMessages(spy: ReturnType<typeof mockMailer>): MailMessage[] {
  return spy.mock.calls.map(([message]) => message);
}

export function resetTokenFrom(message: MailMessage): string {
  const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match?.[1]) throw new Error('No reset link in email');
  return match[1];
}
