/**
 * Creates the first admin (or promotes an existing user). Admin credentials only ever
 * live in the database, hashed; nothing is written to .env or logged.
 *
 *   npm run admin:create                                 # interactive prompts
 *   echo 'pw' | npm run admin:create -- --email a@b.com  # scripted, password on stdin
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import type { ZodType } from 'zod';
import { emailSchema, passwordSchema } from '../src/modules/auth/auth.schemas.js';
import { createAdminUser, promoteToAdmin } from '../src/modules/admin/admin.bootstrap.js';
import {
  SEED_URLS,
  defaultMonitorName,
  seedDemoMonitors,
} from '../src/modules/admin/demo-monitors.js';
import { prisma } from '../src/lib/prisma.js';

// [Node concept: CLI] process.argv parsing with node:util parseArgs (no dependency).
const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    'no-seed': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  stdout.write(
    'Usage: npm run admin:create -- [--email <email>] [--no-seed]\n' +
      'Without a terminal, the password is read from the first line of stdin.\n' +
      'Creating the first admin also adds the sample monitors unless --no-seed is given.\n',
  );
  process.exit(0);
}

const interactive = Boolean(stdin.isTTY);

// [Node concept: CLI] Hiding password input. readline echoes every keystroke by writing it
// to its `output` stream. We give it a Writable that forwards to stdout except while
// `muted`, so the prompt is printed but the typed characters are swallowed.
class MutableStdout extends Writable {
  muted = false;
  override _write(chunk: Buffer, encoding: BufferEncoding, callback: () => void) {
    if (!this.muted) stdout.write(chunk, encoding);
    callback();
  }
}
const output = new MutableStdout();
const rl = interactive ? createInterface({ input: stdin, output, terminal: true }) : undefined;

function requireTerminal(): NonNullable<typeof rl> {
  if (!rl)
    throw new Error(
      'This step needs an interactive terminal. Pass --email and pipe the password on stdin.',
    );
  return rl;
}

async function ask(question: string): Promise<string> {
  return (await requireTerminal().question(question)).trim();
}

async function askHidden(question: string): Promise<string> {
  const terminal = requireTerminal();
  stdout.write(question);
  output.muted = true;
  try {
    return await terminal.question('');
  } finally {
    output.muted = false;
    stdout.write('\n');
  }
}

async function confirm(question: string): Promise<boolean> {
  return /^y(es)?$/i.test(await ask(`${question} (y/N) `));
}

// [Node concept: streams] process.stdin is a Readable stream; `for await` reads it chunk
// by chunk until the writer closes it.
async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

function validateOrExit<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.error(`✖ Invalid ${label}: ${result.error.issues.map((i) => i.message).join(', ')}`);
    process.exit(1);
  }
  return result.data;
}

async function promptNewPassword(): Promise<string> {
  if (!interactive) return readPasswordFromStdin();
  for (;;) {
    const password = await askHidden('Password (min 10 characters, hidden): ');
    const check = passwordSchema.safeParse(password);
    if (!check.success) {
      console.error(`✖ ${check.error.issues.map((i) => i.message).join(', ')}`);
      continue;
    }
    if ((await askHidden('Confirm password: ')) === password) return password;
    console.error('✖ Passwords do not match, try again.');
  }
}

async function main() {
  const rawEmail = args.email ?? (interactive ? await ask('Admin email: ') : undefined);
  if (!rawEmail) {
    console.error('✖ No terminal available: pass --email and pipe the password on stdin.');
    process.exit(1);
  }
  const email = validateOrExit(emailSchema, rawEmail, 'email');
  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    const password = validateOrExit(passwordSchema, await promptNewPassword(), 'password');
    await createAdminUser(email, password);
    stdout.write(`✔ Created admin ${email}\n`);
    await seedIfFirstAdmin();
    return;
  }

  // Existing user: offer promotion (and optionally a new password).
  if (interactive) {
    if (existing.role === 'ADMIN') {
      stdout.write(`${email} is already an admin.\n`);
      if (!(await confirm('Reset their password?'))) return;
    } else if (!(await confirm(`${email} already exists as a regular user. Promote to admin?`))) {
      stdout.write('Nothing changed.\n');
      return;
    }
    const resetPassword = existing.role === 'ADMIN' || (await confirm('Also set a new password?'));
    const password = resetPassword
      ? validateOrExit(passwordSchema, await promptNewPassword(), 'password')
      : undefined;
    await promoteToAdmin(existing.id, password);
  } else {
    // Scripted: promote, and reset the password only if one was piped in.
    const piped = await readPasswordFromStdin();
    const password = piped ? validateOrExit(passwordSchema, piped, 'password') : undefined;
    await promoteToAdmin(existing.id, password);
  }
  stdout.write(
    `✔ ${email} is now an admin${existing.role === 'ADMIN' ? ' (password updated)' : ''}\n`,
  );
  if (existing.role !== 'ADMIN') {
    // A promoted user may already have monitors; don't add samples behind their back.
    stdout.write('  To add the sample monitors to the first admin, run: npm run db:seed\n');
  }
}

/**
 * A fresh install should show data straight away: when the admin just created is the only
 * admin, attach the sample monitors to it (idempotent, same as `npm run db:seed`).
 */
async function seedIfFirstAdmin() {
  if (args['no-seed']) return;
  if ((await prisma.user.count({ where: { role: 'ADMIN' } })) !== 1) return;
  const { created } = await seedDemoMonitors();
  if (created > 0) {
    const names = SEED_URLS.map(defaultMonitorName).join(', ');
    stdout.write(`✔ Added ${created} sample monitors to the dashboard: ${names}\n`);
  }
}

try {
  await main();
} catch (err) {
  console.error('✖', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rl?.close();
  await prisma.$disconnect();
}
