import { type Session, type SessionUser, api, setAccessToken } from './client';

const authRequest = { skipAuthRetry: true } as const;

export async function login(email: string, password: string): Promise<Session> {
  const session = await api<Session>('/auth/login', {
    ...authRequest,
    method: 'POST',
    body: { email, password },
  });
  setAccessToken(session.accessToken);
  return session;
}

export async function signup(email: string, password: string): Promise<Session> {
  const session = await api<Session>('/auth/signup', {
    ...authRequest,
    method: 'POST',
    body: { email, password },
  });
  setAccessToken(session.accessToken);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await api<void>('/auth/logout', { ...authRequest, method: 'POST' });
  } finally {
    setAccessToken(null);
  }
}

export function forgotPassword(email: string) {
  return api<{ message: string }>('/auth/forgot-password', {
    ...authRequest,
    method: 'POST',
    body: { email },
  });
}

export function resetPassword(token: string, password: string) {
  return api<{ message: string }>('/auth/reset-password', {
    ...authRequest,
    method: 'POST',
    body: { token, password },
  });
}

export function fetchMe() {
  return api<{ user: SessionUser }>('/auth/me');
}
