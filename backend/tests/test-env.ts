// Shared by global setup (which migrates the test DB) and per-file setup.
try {
  process.loadEnvFile();
} catch {
  // CI sets variables directly.
}

export function applyTestEnv() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL must be set to run the backend tests');
  }
  // Point everything at the test database, never the dev one.
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.SCHEDULER_ENABLED = 'false';
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
}
