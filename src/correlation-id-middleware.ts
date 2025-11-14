/**
 * Correlation ID Middleware for Distributed Tracing
 *
 * US11 (FR-14): Request Correlation IDs
 *
 * Implements UUID v4 correlation tracking across distributed systems:
 * - Generates UUID v4 for new requests
 * - Accepts client-provided X-Correlation-ID header
 * - Propagates ID in response headers
 * - Attaches ID to request object for logging
 *
 * Constitutional Principle 2 (Security Zero Tolerance):
 * - Validates UUID format to prevent injection attacks
 * - Case-insensitive header handling
 * - Fails open (generates new ID on invalid input)
 *
 * @see RFC 4122 - UUID Standard
 */

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Extended request interface with correlation ID
 */
export interface RequestWithCorrelationId extends IncomingMessage {
  correlationId?: string;
}

/**
 * Middleware function type
 */
export type MiddlewareFunction = (
  req: RequestWithCorrelationId,
  res: ServerResponse,
  next: () => void
) => void;

/**
 * UUID v4 regex for validation
 * Pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * - Version 4 (random): third group starts with '4'
 * - Variant (RFC 4122): fourth group starts with [89ab]
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extract correlation ID from request headers
 *
 * WHY: HTTP headers are case-insensitive per RFC 2616
 * Node.js normalizes them to lowercase, but clients may send any case
 *
 * @param req - Incoming HTTP request
 * @returns Correlation ID string or undefined if not present/invalid
 */
function extractCorrelationId(req: IncomingMessage): string | undefined {
  // T115: Accept X-Correlation-ID header (case-insensitive)
  // Also check uppercase variant for compatibility
  const headerValue = req.headers['x-correlation-id'] || req.headers['X-CORRELATION-ID'];

  if (!headerValue) {
    return undefined;
  }

  // Handle array values (multiple headers with same name)
  // Use first value only (common HTTP pattern)
  const idValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  // Type guard: ensure string type
  if (typeof idValue !== 'string') {
    return undefined;
  }

  // Trim whitespace (defensive programming)
  const trimmedId = idValue.trim();

  // Validate empty string
  if (trimmedId.length === 0) {
    return undefined;
  }

  // T115: Validate UUID format (security: prevent injection)
  // FIX: Optimize validation order (regex first as fast path)
  //
  // WHY: Regex check is faster than library validation (~10x)
  // - Regex rejects non-UUID-looking strings immediately (e.g., "abc123")
  // - Library validates checksums/variants only for UUID-shaped strings
  // - Reduces validation overhead for malformed inputs

  // Fast path: Reject non-UUID-looking strings with regex
  if (!UUID_V4_REGEX.test(trimmedId)) {
    return undefined;
  }

  // Slow path: Validate RFC 4122 compliance with library
  // This catches invalid checksums and variant bits that regex misses
  if (!uuidValidate(trimmedId)) {
    // Invalid UUID format - reject and generate new one
    // WHY: Fail open (generate new ID) rather than fail closed (reject request)
    // This ensures service availability over strict validation
    return undefined;
  }

  return trimmedId;
}

/**
 * Correlation ID Middleware
 *
 * Express-style middleware that:
 * 1. Extracts or generates correlation ID
 * 2. Attaches ID to request object
 * 3. Sets X-Correlation-ID response header
 * 4. Calls next() to continue request processing
 *
 * USAGE:
 * ```typescript
 * import { correlationIdMiddleware } from './correlation-id-middleware.js';
 *
 * server.on('request', (req, res) => {
 *   correlationIdMiddleware(req, res, () => {
 *     // req.correlationId available here
 *     console.log('Request ID:', req.correlationId);
 *   });
 * });
 * ```
 *
 * @param req - HTTP request object
 * @param res - HTTP response object
 * @param next - Callback to invoke next middleware/handler
 */
export function correlationIdMiddleware(
  req: RequestWithCorrelationId,
  res: ServerResponse,
  next: () => void
): void {
  // T115: Try to extract client-provided correlation ID
  let correlationId = extractCorrelationId(req);

  // T114 & T119: Generate UUID v4 if not provided or invalid
  if (!correlationId) {
    correlationId = uuidv4();
  }

  // T117: Attach correlation ID to request object
  // WHY: Makes ID available to all downstream handlers/middleware
  // Use case: Logging, error tracking, audit trails
  req.correlationId = correlationId;

  // T116 & T121: Set X-Correlation-ID response header
  // WHY: Allows client to correlate request/response for debugging
  // Only set if headers not already sent (defensive programming)
  if (!res.headersSent) {
    res.setHeader('X-Correlation-ID', correlationId);
  }

  // Continue to next middleware/handler
  // IMPORTANT: Always call next() to prevent request hanging
  next();
}

/**
 * Get correlation ID from request
 *
 * Helper function for accessing correlation ID in handlers
 * Provides type-safe access with fallback to 'unknown'
 *
 * @param req - HTTP request object
 * @returns Correlation ID or 'unknown' if not set
 *
 * @example
 * const correlationId = getCorrelationId(req);
 * logger.log({ correlationId, message: 'Request processed' });
 */
export function getCorrelationId(req: RequestWithCorrelationId): string {
  return req.correlationId || 'unknown';
}

/**
 * Validate correlation ID format
 *
 * Exported for testing and external validation
 *
 * @param id - Correlation ID to validate
 * @returns True if valid UUID v4 format
 */
export function isValidCorrelationId(id: string): boolean {
  return UUID_V4_REGEX.test(id) && uuidValidate(id);
}
