/**
 * Attaches 10 sample monitors to the first admin. Idempotent: running it twice changes
 * nothing, thanks to the unique (userId, url) index and upsert.
 */
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma.js';

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

export async function seedDemoMonitors(): Promise<{ adminEmail: string; created: number }> {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new NoAdminError();

  let created = 0;
  for (const url of SEED_URLS) {
    const existing = await prisma.monitor.findUnique({
      where: { userId_url: { userId: admin.id, url } },
    });
    if (existing) continue;
    await prisma.monitor.create({
      data: { userId: admin.id, url, name: defaultMonitorName(url) },
    });
    created++;
  }
  return { adminEmail: admin.email, created };
}

// Run only when executed directly (`tsx prisma/seed.ts`), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { adminEmail, created } = await seedDemoMonitors();
    console.log(
      `✔ Seeded ${created} new monitor(s) for ${adminEmail} ` +
        `(${SEED_URLS.length - created} already existed).`,
    );
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
