import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

// [Node concept: stateless processes] One PrismaClient (and one connection pool) per
// process. Modules are cached after first import, so every importer shares this instance.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
