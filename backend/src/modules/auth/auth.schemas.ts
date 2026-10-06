import { z } from 'zod';

// Zod schemas play the role of Laravel Form Requests: they validate and normalise input
// before it reaches a controller. The frontend mirrors these rules for instant feedback.

export const PASSWORD_MIN_LENGTH = 10;

// The most common passwords that also meet the length rule. Deliberately small; a real
// system would check against a breach corpus (e.g. the HIBP k-anonymity API).
export const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  'password123',
  'password12',
  'qwertyuiop',
  '1q2w3e4r5t',
  'qwerty1234',
  '123456789a',
  'iloveyou12',
  'passw0rd123',
]);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  // bcrypt only uses the first 72 bytes of its input; reject longer passwords rather than
  // silently ignoring the tail.
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'This password is too common, choose another',
  );

export const signupSchema = z.object({ email: emailSchema, password: passwordSchema });
export type SignupInput = z.infer<typeof signupSchema>;

// Login doesn't re-check password rules: the stored hash is the only source of truth.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
