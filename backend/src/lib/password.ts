import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

// Cost 12 takes ~250ms per hash: slow for attackers, fine for humans. Tests use the
// minimum cost so the suite stays fast.
const SALT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;

// [Node concept: event loop] bcrypt is deliberately CPU-heavy. The async API runs the
// hashing on libuv's thread pool, so the event loop keeps serving other requests.
// bcrypt.hashSync would freeze the whole server for ~250ms per call.
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// A real hash of a random string, computed once. Comparing against it when the email
// doesn't exist makes "unknown email" take as long as "wrong password", so response
// timing doesn't reveal which emails are registered.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash('pulsecheck-timing-equaliser', SALT_ROUNDS);
  await bcrypt.compare(password, await dummyHash);
}
