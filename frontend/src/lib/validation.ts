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

// Monitor rules, mirroring backend/src/modules/monitors/monitors.schemas.ts. The server
// additionally resolves the hostname and refuses private addresses.

export function validateMonitorUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return 'Enter the URL to monitor';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a full URL, e.g. https://example.com';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http:// and https:// URLs can be monitored';
  }
  if (!['', '80', '443'].includes(url.port))
    return 'Only the standard ports 80 and 443 are allowed';
  if (url.username || url.password) return 'URLs with a username or password are not allowed';
  return undefined;
}

export function validateInterval(value: string): string | undefined {
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Enter a whole number of minutes';
  if (n < 5) return 'Checks can run at most every 5 minutes';
  if (n > 1440) return 'Interval can be at most 1440 minutes (24 hours)';
  return undefined;
}

export function validateTimeout(value: string): string | undefined {
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Enter a whole number of milliseconds';
  if (n < 1000 || n > 30_000) return 'Timeout must be between 1000 and 30000 ms';
  return undefined;
}
