// Response shapes of the PulseCheck API (see docs/api.md).

export type MonitorStatus = 'UNKNOWN' | 'UP' | 'DOWN';

export interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
  isPaused: boolean;
  currentStatus: MonitorStatus;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  sslExpiresAt: string | null;
  sslCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckResult {
  checkedAt: string;
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

export interface Check extends CheckResult {
  id: string;
}

export interface MonitorListItem extends Monitor {
  lastCheck: CheckResult | null;
  uptime24h: number | null;
  recentChecks: { checkedAt: string; isUp: boolean }[];
}

export interface MonitorList {
  monitors: MonitorListItem[];
  usage: { used: number; max: number };
}

export interface MonitorStats {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  avgResponseMs24h: number | null;
  checks24h: number;
}

export interface MonitorDetail extends Monitor {
  lastCheck: CheckResult | null;
  stats: MonitorStats;
}

export interface Incident {
  id: string;
  startedAt: string;
  resolvedAt: string | null;
  cause: string;
}

export interface Account {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  alertsEnabled: boolean;
  createdAt: string;
}

export interface AdminStats {
  users: { total: number; admins: number; disabled: number };
  monitors: { total: number; up: number; down: number; unknown: number; paused: number };
  checksLast24h: number;
  lastRun: {
    checked: number;
    up: number;
    down: number;
    errors: number;
    durationMs: number;
    startedAt: string;
    finishedAt: string;
  } | null;
  schedulerEnabled: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isDisabled: boolean;
  createdAt: string;
  monitorCount: number;
}

export interface AdminMonitor {
  id: string;
  name: string;
  url: string;
  intervalMinutes: number;
  isPaused: boolean;
  currentStatus: MonitorStatus;
  lastCheckedAt: string | null;
  sslExpiresAt: string | null;
  createdAt: string;
  owner: { id: string; email: string; isDisabled: boolean };
}

export type AdminMonitorStatusFilter = '' | 'UP' | 'DOWN' | 'UNKNOWN' | 'PAUSED';
