/**
 * `npm run db:seed`: attaches the sample monitors to the first admin. Idempotent.
 * `npm run admin:create` already does this when it creates the first admin, so this is
 * only needed to restore deleted samples or after promoting an existing user.
 */
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { SEED_URLS, seedDemoMonitors } from '../src/modules/admin/demo-monitors.js';

export {
  NoAdminError,
  SEED_URLS,
  defaultMonitorName,
  seedDemoMonitors,
} from '../src/modules/admin/demo-monitors.js';

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
