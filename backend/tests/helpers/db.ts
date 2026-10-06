import { prisma } from '../../src/lib/prisma.js';

const TABLES = [
  'checks',
  'incidents',
  'monitors',
  'password_reset_tokens',
  'refresh_tokens',
  'users',
];

/** Empties every table. Call in beforeEach so each test starts from a clean database. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
