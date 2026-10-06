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
