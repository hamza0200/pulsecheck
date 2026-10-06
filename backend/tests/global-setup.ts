import { execSync } from 'node:child_process';
import { applyTestEnv } from './test-env.js';

// Bring the test database schema up to date once before the whole run.
export default function setup() {
  applyTestEnv();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
