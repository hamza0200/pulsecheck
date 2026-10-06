import { execSync } from 'node:child_process';
import { applyTestEnv } from '../tests/test-env.js';

applyTestEnv();
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
