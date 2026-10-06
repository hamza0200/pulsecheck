import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import type { ListUsersQuery, UpdateUserInput, UserIdParams } from './admin.schemas.js';
import { adminService } from './admin.service.js';

export const stats: RequestHandler = async (_req, res) => {
  res.json(await adminService.stats());
};

export const listUsers: RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  ListUsersQuery
> = async (req, res) => {
  res.json(await adminService.listUsers(req.query));
};

export const updateUser: RequestHandler<UserIdParams, unknown, UpdateUserInput> = async (
  req,
  res,
) => {
  const user = await adminService.setDisabled(currentUser(req).id, req.params.id, req.body);
  res.json({ user });
};
