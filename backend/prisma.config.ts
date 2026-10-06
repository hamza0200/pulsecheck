import { defineConfig } from 'prisma/config';

// [Node concept: .env handling] Node 22+ can load .env files natively.
// Variables already set in the real environment win over the file.
try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. CI) — rely on the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` doesn't need a database, so don't fail if the URL is missing.
    url: process.env.DATABASE_URL ?? '',
  },
});
