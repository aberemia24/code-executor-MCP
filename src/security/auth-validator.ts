/**
 * Authentication Validator Interface
 *
 * Validates API keys for HTTP transport authentication.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * Security considerations:
 * - Constant-time comparison (crypto.timingSafeEqual)
 * - No API keys in logs (SHA-256 hash only)
 * - Failed attempts audited with client IP
 *
 * @see https://codahale.com/a-lesson-in-timing-attacks/
 */

export interface AuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** Client identifier (if authenticated) */
  clientId?: string;
  /** Error message (if authentication failed) */
  errorMessage?: string;
  /** Hint for fixing authentication (e.g., "Provide Authorization: Bearer <KEY> header") */
  hint?: string;
}

export interface IAuthValidator {
  /**
   * Validates API key using constant-time comparison
   *
   * @param apiKey - API key from Authorization: Bearer header
   * @returns Authentication result with clientId or error
   * @throws {Error} If apiKey format is invalid (AJV validation error) or internal crypto operations fail
   */
  validateKey(apiKey: string): Promise<AuthResult>;

  /**
   * Checks if authentication is enabled
   *
   * @returns True if auth required, false if disabled (STDIO mode)
   */
  isEnabled(): boolean;
}
