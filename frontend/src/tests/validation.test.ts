/**
 * Client-side validation rules (unit), mirroring the backend's Zod schemas.
 * - Email required and well-formed
 * - New password: min 10 characters, max 72 bytes, not a common password
 * - Confirmation must match
 * - Strength hint levels
 */
import { describe, expect, it } from 'vitest';
import {
  passwordStrength,
  validateConfirmation,
  validateEmail,
  validateNewPassword,
} from '../lib/validation';

describe('validation', () => {
  it('validates emails', () => {
    expect(validateEmail('')).toBe('Enter your email address');
    expect(validateEmail('nope')).toBe('Enter a valid email address');
    expect(validateEmail(' ada@example.com ')).toBeUndefined();
  });

  it('validates new passwords like the server does', () => {
    expect(validateNewPassword('short')).toMatch(/at least 10/);
    expect(validateNewPassword('QWERTYUIOP')).toMatch(/too common/);
    expect(validateNewPassword('é'.repeat(37))).toBe('Password is too long'); // 74 bytes
    expect(validateNewPassword('correct-horse-battery')).toBeUndefined();
  });

  it('checks the confirmation', () => {
    expect(validateConfirmation('abc', '')).toBe('Confirm your password');
    expect(validateConfirmation('abc', 'abd')).toBe("Passwords don't match");
    expect(validateConfirmation('abc', 'abc')).toBeUndefined();
  });

  it('grades strength', () => {
    expect(passwordStrength('short')).toBe('too-short');
    expect(passwordStrength('aaaaaaaaaa')).toBe('weak');
    expect(passwordStrength('aaaaaaaaa1')).toBe('fair');
    expect(passwordStrength('Correct-Horse-9')).toBe('strong');
  });
});
