import type { Express } from 'express';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';

export const STRONG_PASSWORD = 'correct-horse-battery';

/** Extracts `pc_refresh=<value>` from a response's Set-Cookie headers. */
export function refreshCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const cookie = cookies.find((c) => c.startsWith('pc_refresh=') && !c.startsWith('pc_refresh=;'));
  return cookie?.split(';')[0];
}

export interface TestSession {
  accessToken: string;
  cookie: string;
  user: { id: string; email: string; role: string };
}

export async function signupUser(
  app: Express,
  email = `user-${crypto.randomUUID()}@example.com`,
  password = STRONG_PASSWORD,
): Promise<TestSession> {
  const res = await request(app).post('/api/auth/signup').send({ email, password });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    accessToken: res.body.accessToken,
    cookie: refreshCookieFrom(res)!,
    user: res.body.user,
  };
}

/** Signs up a user, promotes them in the database, and returns a fresh session. */
export async function signupAdmin(
  app: Express,
  email = `admin-${crypto.randomUUID()}@example.com`,
) {
  const session = await signupUser(app, email);
  await prisma.user.update({ where: { id: session.user.id }, data: { role: 'ADMIN' } });
  return session;
}
