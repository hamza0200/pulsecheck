import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies.js';
import type {
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SignupInput,
} from './auth.schemas.js';
import { type Session, authService } from './auth.service.js';
import { FORGOT_PASSWORD_MESSAGE, passwordResetService } from './password-reset.service.js';

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
  const { id, email, role, alertsEnabled } = currentUser(req);
  res.json({ user: { id, email, role, alertsEnabled } });
};

export const forgotPassword: RequestHandler<object, unknown, ForgotPasswordInput> = async (
  req,
  res,
) => {
  await passwordResetService.requestReset(req.body.email);
  res.json({ message: FORGOT_PASSWORD_MESSAGE });
};

export const resetPassword: RequestHandler<object, unknown, ResetPasswordInput> = async (
  req,
  res,
) => {
  await passwordResetService.resetPassword(req.body.token, req.body.password);
  res.json({ message: 'Your password has been reset. You can now log in.' });
};
