import { EventEmitter } from 'node:events';
import type { MonitorStatus } from '../generated/prisma/client.js';
import { logger } from './logger.js';

interface MonitorRef {
  /** Owner of the monitor: listeners use it to scope emails and SSE streams. */
  userId: string;
  monitorId: string;
  name: string;
  url: string;
}

export interface MonitorCheckedEvent extends MonitorRef {
  status: MonitorStatus;
  checkedAt: Date;
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  consecutiveFailures: number;
}
export interface MonitorDownEvent extends MonitorRef {
  cause: string;
  startedAt: Date;
}
export interface MonitorRecoveredEvent extends MonitorRef {
  /** When the incident started, so the email can say how long it was down. */
  downSince: Date | null;
  recoveredAt: Date;
}
export interface MonitorSslExpiringEvent extends MonitorRef {
  expiresAt: Date;
  daysLeft: number;
}

export interface UserDisabledEvent {
  userId: string;
}

/** Event name -> listener argument tuple. */
export interface AppEvents {
  'monitor.checked': [MonitorCheckedEvent];
  'monitor.down': [MonitorDownEvent];
  'monitor.recovered': [MonitorRecoveredEvent];
  'monitor.sslExpiring': [MonitorSslExpiringEvent];
  'user.disabled': [UserDisabledEvent];
  error: [unknown];
}

// [Node concept: EventEmitter] A typed in-process event bus. The check runner only emits;
// alerts and SSE subscribe. Neither side imports the other, so adding a listener (Slack,
// webhooks) never touches the runner. emit() calls listeners synchronously, in order.
export const events = new EventEmitter<AppEvents>({ captureRejections: true });

// [Node concept: EventEmitter] An 'error' event with no listener crashes the process.
// With captureRejections, a rejected async listener is routed here too.
events.on('error', (err) => {
  logger.error({ err }, 'Event listener failed');
});
