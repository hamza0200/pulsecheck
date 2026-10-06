import { z } from 'zod';

export const MIN_INTERVAL_MINUTES = 5;

/**
 * Normalises a URL so "https://Example.com/" and "https://example.com" are the same
 * monitor: lowercase host (done by URL), no fragment, no trailing slash on a bare path.
 * Protocol/port/SSRF rules are enforced by the SSRF guard in the service.
 */
export function normaliseUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  const href = url.href;
  return url.pathname === '/' && !url.search ? href.replace(/\/$/, '') : href;
}

const urlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .max(2048, 'URL is too long')
  .refine((value) => URL.canParse(value), 'Enter a valid URL, e.g. https://example.com')
  .transform(normaliseUrl);

const nameSchema = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');

const intervalSchema = z
  .number()
  .int()
  .min(MIN_INTERVAL_MINUTES, `Checks can run at most every ${MIN_INTERVAL_MINUTES} minutes`)
  .max(1440, 'Interval can be at most 1440 minutes (24 hours)');

const timeoutSchema = z
  .number()
  .int()
  .min(1000, 'Timeout must be at least 1000 ms')
  .max(30_000, 'Timeout can be at most 30000 ms');

export const createMonitorSchema = z.strictObject({
  name: nameSchema.optional(),
  url: urlSchema,
  intervalMinutes: intervalSchema.default(10),
  timeoutMs: timeoutSchema.default(10_000),
});
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

export const updateMonitorSchema = z
  .strictObject({
    name: nameSchema,
    url: urlSchema,
    intervalMinutes: intervalSchema,
    timeoutMs: timeoutSchema,
    isPaused: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

export const monitorIdParamsSchema = z.object({ id: z.uuid('Invalid monitor id') });
export type MonitorIdParams = z.infer<typeof monitorIdParamsSchema>;

export const listChecksQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  /** Only checks after this time (used for the 24h chart). */
  since: z.iso.datetime({ offset: true }).optional(),
});
export type ListChecksQuery = z.infer<typeof listChecksQuerySchema>;

export const listIncidentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
