import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies.js';
import type { LoginInput, SignupInput } from './auth.schemas.js';
import { type Session, authService } from './auth.service.js';

// Controllers translate HTTP <-> service calls. They never contain business rules.

function sendSession(res: Parameters<RequestHandler>[1], session: Session, status = 200) {
  setRefreshCookie(res, session.refreshToken);
  res.status(status).json({ accessToken: session.accessToken, user: session.user });
}

export const signup: RequestHandler<object, unknown, SignupInput> = async (req, res) => {
  sendSession(res, await authService.signup(req.body), 201);
};

export const login: RequestHandler<object, unknown, LoginInput> = async (req, res) => {
  sendSession(res, await authService.login(req.body));
};

export const refresh: RequestHandler = async (req, res) => {
  try {
    sendSession(res, await authService.refresh(readRefreshCookie(req.cookies)));
  } catch (err) {
    // Whatever went wrong, the cookie is useless now; stop the browser resending it.
    clearRefreshCookie(res);
    throw err;
  }
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(readRefreshCookie(req.cookies));
  clearRefreshCookie(res);
  res.status(204).end();
};

export const me: RequestHandler = (req, res) => {
  res.json({ user: currentUser(req) });
};
