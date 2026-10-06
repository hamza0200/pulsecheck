// Mirrors the backend Zod rules (backend/src/modules/auth/auth.schemas.ts) so users get
// instant feedback. The server still validates everything.

export const PASSWORD_MIN_LENGTH = 10;

const COMMON_PASSWORDS = new Set([
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return 'Enter your email address';
  if (!EMAIL_PATTERN.test(value) || value.length > 254) return 'Enter a valid email address';
  return undefined;
}

export function validateNewPassword(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (new TextEncoder().encode(password).length > 72) return 'Password is too long';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'This password is too common, choose another';
  }
  return undefined;
}

export function validateConfirmation(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Confirm your password';
  return password === confirm ? undefined : "Passwords don't match";
}

export type Strength = 'too-short' | 'weak' | 'fair' | 'strong';

/** A rough hint, not a security control: length matters most, variety helps. */
export function passwordStrength(password: string): Strength {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too-short';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 16 || (password.length >= 12 && classes >= 3)) return 'strong';
  if (classes >= 2) return 'fair';
  return 'weak';
}
