import { prisma } from '../../lib/prisma.js';

/** Sample sites attached to the first admin, so a fresh install has data to look at. */
export const SEED_URLS = [
  'https://w3toolkit.com',
  'https://w3generators.com',
  'https://qrcode-panda.com',
  'https://w3programmings.com',
  'https://happinessmeansbusiness.com',
  'https://hamzamehmood.com',
  'https://araceuas.com',
  'https://www.premierassistedlivingfacility.com',
  'https://changeforchangecreativesolutions.net',
  'https://ezwills.com.sg',
];

export function defaultMonitorName(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export class NoAdminError extends Error {
  constructor() {
    super(
      'No admin user found. Run `npm run admin:create` first, then run `npm run db:seed` again.',
    );
  }
}

/**
 * Attaches the sample monitors to the FIRST admin (oldest by creation date). Idempotent:
 * monitors that already exist (unique userId + url) are skipped, so it is safe to run any
 * number of times. Used by `npm run db:seed` and automatically by `npm run admin:create`
 * when it creates the first admin.
 */
export async function seedDemoMonitors(): Promise<{
  adminId: string;
  adminEmail: string;
  created: number;
}> {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new NoAdminError();

  const { count } = await prisma.monitor.createMany({
    data: SEED_URLS.map((url) => ({ userId: admin.id, url, name: defaultMonitorName(url) })),
    skipDuplicates: true,
  });
  return { adminId: admin.id, adminEmail: admin.email, created: count };
}
