import { WalletError, ErrorCodes } from '../output/errors.js';

const MIN_PASSWORD_LENGTH = 12;

/**
 * Validate that a password meets minimum strength requirements.
 * Throws WalletError if the password is too weak.
 */
export function validatePasswordStrength(password: string): void {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length})`);
  }

  if (!/[a-z]/.test(password)) {
    errors.push('at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('at least one digit');
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push('at least one special character');
  }

  if (errors.length > 0) {
    throw new WalletError(
      ErrorCodes.ERR_INVALID_INPUT,
      `Password too weak. Requirements: ${errors.join('; ')}.`,
    );
  }
}
