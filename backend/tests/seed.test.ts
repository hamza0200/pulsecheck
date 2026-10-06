import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { NoAdminError, SEED_URLS, seedDemoMonitors } from '../prisma/seed.js';
import { resetDb } from './helpers/db.js';

beforeEach(resetDb);

describe('db:seed', () => {
  it('fails with a clear message when no admin exists', async () => {
    await expect(seedDemoMonitors()).rejects.toThrow(NoAdminError);
    await expect(seedDemoMonitors()).rejects.toThrow(/npm run admin:create/);
  });

  it('attaches the 10 sites to the first admin and is idempotent', async () => {
    const admin = await prisma.user.create({
      data: { email: 'first-admin@example.com', passwordHash: 'x', role: 'ADMIN' },
    });
    await prisma.user.create({
      data: { email: 'second-admin@example.com', passwordHash: 'x', role: 'ADMIN' },
    });

    expect((await seedDemoMonitors()).created).toBe(10);
    expect((await seedDemoMonitors()).created).toBe(0);

    const monitors = await prisma.monitor.findMany({ where: { userId: admin.id } });
    expect(monitors).toHaveLength(SEED_URLS.length);
    expect(monitors.map((m) => m.name)).toContain('premierassistedlivingfacility.com');
    expect(await prisma.monitor.count()).toBe(10);
  });
});
