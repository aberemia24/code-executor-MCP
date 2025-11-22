/**
 * HTTP Authentication Middleware (US3: FR-3)
 *
 * Implements bearer token authentication for HTTP transport mode.
 * Security-critical component using constant-time comparison.
 *
 * **WHY Bearer Token?**
 * - Industry standard (OAuth 2.0, RFC 6750)
 * - Stateless (no session management)
 * - Easy to rotate and revoke
 *
 * **WHY Constant-Time Comparison?**
 * - Prevents timing attacks (attacker measures response time to guess key)
 * - crypto.timingSafeEqual ensures equal time regardless of where mismatch occurs
 * - Critical for security (non-negotiable per Principle 2)
 *
 * **WHY 32-128 character key length?**
 * - 32 chars minimum: ~192 bits entropy (secure against brute force)
 * - 128 chars maximum: Reasonable limit (prevent DoS via huge headers)
 * - Configurable via HTTP_API_KEYS env var
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6750
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface HttpAuthConfig {
  /** Map of API key → client ID */
  apiKeys: Map<string, string>;
  /** Enable authentication (default: true) */
  enabled?: boolean;
}

/**
 * HTTP Authentication Middleware
 *
 * Validates bearer tokens using constant-time comparison.
 * Logs failed auth attempts for security monitoring.
 */
export class HttpAuthMiddleware {
  private readonly config: HttpAuthConfig;
  private readonly keyPattern = /^[A-Za-z0-9_-]{32,128}$/;

  constructor(config: HttpAuthConfig) {
    this.config = {
      enabled: config.enabled ?? true,
      apiKeys: config.apiKeys,
    };
  }

  /**
   * Express middleware for bearer token authentication
   *
   * @param req - Express request
   * @param res - Express response
   * @param next - Next middleware function
   */
  authenticate = (req: Request, res: Response, next: NextFunction): void => {
    // Skip authentication if disabled
    if (!this.config.enabled) {
      next();
      return;
    }

    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      this.sendUnauthorized(res, 'Authorization header missing', req.ip);
      return;
    }

    // Check Bearer scheme
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer') {
      this.sendUnauthorized(res, 'Invalid authorization scheme (expected Bearer)', req.ip);
      return;
    }

    if (!token) {
      this.sendUnauthorized(res, 'API key missing in Authorization header', req.ip);
      return;
    }

    // Validate API key format (AJV-style validation)
    if (!this.keyPattern.test(token)) {
      this.sendUnauthorized(
        res,
        'Invalid API key format (expected 32-128 alphanumeric characters, underscores, and hyphens)',
        req.ip
      );
      return;
    }

    // Validate API key using constant-time comparison
    const clientId = this.validateKey(token);

    if (!clientId) {
      // Log failed auth attempt with hashed key
      const hashedKey = crypto.createHash('sha256').update(token).digest('hex');
      console.warn(
        `[Auth Failure] Invalid API key attempt | ` +
          `Key Hash: ${hashedKey.substring(0, 16)}... | ` +
          `Client IP: ${req.ip} | ` +
          `Timestamp: ${new Date().toISOString()}`
      );

      this.sendUnauthorized(res, 'Invalid API key', req.ip);
      return;
    }

    // Authentication successful - attach client ID to request
    (req as any).clientId = clientId;
    next();
  };

  /**
   * Validates API key using constant-time comparison
   *
   * WHY constant-time? Prevents timing attacks where attacker
   * measures response time to guess correct key character-by-character.
   *
   * @param providedKey - API key from request
   * @returns Client ID if valid, null if invalid
   * @private
   */
  private validateKey(providedKey: string): string | null {
    // Check each configured API key using constant-time comparison
    for (const [validKey, clientId] of this.config.apiKeys.entries()) {
      try {
        // Convert strings to buffers for timingSafeEqual
        const providedBuffer = Buffer.from(providedKey, 'utf8');
        const validBuffer = Buffer.from(validKey, 'utf8');

        // timingSafeEqual requires same length (security feature)
        if (providedBuffer.length !== validBuffer.length) {
          continue; // Try next key
        }

        // Constant-time comparison (prevents timing attacks)
        if (crypto.timingSafeEqual(providedBuffer, validBuffer)) {
          return clientId;
        }
      } catch (error) {
        // timingSafeEqual throws if lengths differ (already handled above)
        continue;
      }
    }

    return null; // No matching key found
  }

  /**
   * Sends 401 Unauthorized response
   *
   * @param res - Express response
   * @param message - Error message
   * @param clientIp - Client IP for logging
   * @private
   */
  private sendUnauthorized(res: Response, message: string, clientIp?: string): void {
    res.status(401).json({
      error: message,
      hint: 'Provide Authorization: Bearer <API_KEY> header with a valid API key (32-128 alphanumeric characters)',
      timestamp: new Date().toISOString(),
    });
  }
}
