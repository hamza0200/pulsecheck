import { z } from 'zod';
import { passwordSchema } from '../auth/auth.schemas.js';

export const updateAccountSchema = z.strictObject({ alertsEnabled: z.boolean() });
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required').max(200),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
