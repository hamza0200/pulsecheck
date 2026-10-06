import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(254).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.object({ id: z.uuid('Invalid user id') });
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

export const updateUserSchema = z.strictObject({ isDisabled: z.boolean() });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listAdminMonitorsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Case-insensitive match on URL, monitor name or owner email. */
  search: z.string().trim().max(254).optional(),
  userId: z.uuid('Invalid user id').optional(),
  status: z.enum(['UP', 'DOWN', 'UNKNOWN', 'PAUSED']).optional(),
});
export type ListAdminMonitorsQuery = z.infer<typeof listAdminMonitorsQuerySchema>;
