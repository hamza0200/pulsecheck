import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import { clearRefreshCookie } from '../auth/auth.cookies.js';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  UpdateAccountInput,
} from './account.schemas.js';
import { accountService } from './account.service.js';

export const getAccount: RequestHandler = async (req, res) => {
  res.json({ account: await accountService.get(currentUser(req).id) });
};

export const updateAccount: RequestHandler<object, unknown, UpdateAccountInput> = async (
  req,
  res,
) => {
  res.json({ account: await accountService.update(currentUser(req).id, req.body) });
};

export const changePassword: RequestHandler<object, unknown, ChangePasswordInput> = async (
  req,
  res,
) => {
  await accountService.changePassword(currentUser(req).id, req.sessionId, req.body);
  res.json({ message: 'Password changed. Other sessions have been signed out.' });
};

export const deleteAccount: RequestHandler<object, unknown, DeleteAccountInput> = async (
  req,
  res,
) => {
  await accountService.deleteAccount(currentUser(req).id, req.body.password);
  clearRefreshCookie(res);
  res.status(204).end();
};
