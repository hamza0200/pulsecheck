import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { verifyPassword } from '../src/lib/password.js';
import { resetDb } from './helpers/db.js';

const execFileAsync = promisify(execFile);

/** Runs the real CLI script non-interactively, piping `stdin` to it. */
async function runCli(args: string[], stdin: string) {
  const child = execFileAsync('npx', ['tsx', 'scripts/create-admin.ts', ...args], {
    env: process.env, // already points DATABASE_URL at the test database
  });
  child.child.stdin?.end(stdin);
  try {
    const { stdout } = await child;
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

beforeEach(resetDb);

describe('admin:create CLI (non-interactive)', () => {
  it('creates a new ADMIN with a bcrypt-hashed password', async () => {
    const result = await runCli(['--email', 'Boss@Example.com'], 'a-very-long-password\n');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Created admin boss@example.com');
    expect(result.stdout).not.toContain('a-very-long-password');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'boss@example.com' } });
    expect(user.role).toBe('ADMIN');
    expect(await verifyPassword('a-very-long-password', user.passwordHash)).toBe(true);
  });

  it('promotes an existing user and keeps their password when none is piped', async () => {
    await prisma.user.create({
      data: { email: 'existing@example.com', passwordHash: 'unchanged-hash' },
    });
    const result = await runCli(['--email', 'existing@example.com'], '');
    expect(result.code).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'existing@example.com' } });
    expect(user.role).toBe('ADMIN');
    expect(user.passwordHash).toBe('unchanged-hash');
  });

  it('rejects a weak password with the same rules as signup', async () => {
    const result = await runCli(['--email', 'weak@example.com'], 'short\n');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/at least 10 characters/);
    expect(await prisma.user.count()).toBe(0);
  });
});
