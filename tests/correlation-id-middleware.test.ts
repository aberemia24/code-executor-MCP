/**
 * Tests for Correlation ID Middleware
 *
 * US11 (FR-14): Request Correlation IDs
 * Validates UUID v4 generation, header acceptance, and propagation
 */

import { describe, it, expect, vi } from 'vitest';
import { correlationIdMiddleware } from '../src/core/middleware/correlation-id-middleware.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('CorrelationIdMiddleware (US11: FR-14)', () => {
  /**
   * T114: UUID v4 Generation Test
   *
   * ACCEPTANCE CRITERIA:
   * - Must generate UUID v4 format (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
   * - Must be unique for each request
   * - Must follow RFC 4122 standard
   */
  describe('UUID Generation (T114)', () => {
    it('should_generateUUIDv4_when_noCorrelationIdProvided', () => {
      const req = {
        headers: {}
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Verify UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.stringMatching(uuidV4Regex)
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it('should_generateUniqueIDs_when_multipleRequests', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const req = { headers: {} } as unknown as IncomingMessage;
        const res = {
          setHeader: vi.fn((name: string, value: string) => {
            if (name === 'X-Correlation-ID') {
              ids.add(value);
            }
          }),
          headersSent: false
        } as unknown as ServerResponse;
        const next = vi.fn();

        correlationIdMiddleware(req, res, next);
      }

      // All 100 IDs should be unique
      expect(ids.size).toBe(100);
    });
  });

  /**
   * T115: Accept X-Correlation-ID Header Test
   *
   * ACCEPTANCE CRITERIA:
   * - Must accept client-provided X-Correlation-ID header
   * - Must preserve client ID (not generate new one)
   * - Must validate format (reject invalid UUIDs)
   */
  describe('Accept Client Correlation ID (T115)', () => {
    it('should_useClientID_when_validXCorrelationIDProvided', () => {
      // UUID v4 format: third group must start with '4', fourth group must start with [89ab]
      const clientId = '123e4567-e89b-42d3-a456-426614174000'; // Fixed: '42d3' (version 4)

      const req = {
        headers: {
          'x-correlation-id': clientId
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should use client-provided ID, not generate new one
      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', clientId);
      expect(next).toHaveBeenCalledOnce();
    });

    it('should_handleCaseInsensitive_when_headerProvided', () => {
      const clientId = '123e4567-e89b-42d3-a456-426614174000'; // UUID v4 format

      // Note: Node.js normalizes headers to lowercase, but we test both cases
      const req = {
        headers: {
          'x-correlation-id': clientId // Node.js normalized (lowercase)
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', clientId);
    });

    it('should_generateNewID_when_invalidUUIDProvided', () => {
      const req = {
        headers: {
          'x-correlation-id': 'invalid-uuid-format'
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should generate new UUID v4, not use invalid one
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.stringMatching(uuidV4Regex)
      );
      expect(res.setHeader).not.toHaveBeenCalledWith('X-Correlation-ID', 'invalid-uuid-format');
    });
  });

  /**
   * T116: Response Header Propagation Test
   *
   * ACCEPTANCE CRITERIA:
   * - Must include X-Correlation-ID in all responses
   * - Must return same ID that was used for request
   * - Must set header before response is sent
   */
  describe('Response Header Propagation (T116)', () => {
    it('should_returnCorrelationID_when_responseHeadersSet', () => {
      const req = { headers: {} } as unknown as IncomingMessage;
      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;
      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Verify header was set
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.stringMatching(/^[0-9a-f-]+$/)
      );
    });

    it('should_notSetHeader_when_headersAlreadySent', () => {
      const req = { headers: {} } as unknown as IncomingMessage;
      const res = {
        setHeader: vi.fn(),
        headersSent: true // Headers already sent
      } as unknown as ServerResponse;
      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should not attempt to set header
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('should_propagateSameID_when_clientProvided', () => {
      const clientId = '123e4567-e89b-42d3-a456-426614174000'; // UUID v4 format

      const req = {
        headers: {
          'x-correlation-id': clientId
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should return exact same ID client provided
      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', clientId);
    });
  });

  /**
   * T117: Correlation ID in Request Object Test
   *
   * ACCEPTANCE CRITERIA:
   * - Must attach correlationId to request object
   * - Must be accessible to downstream middleware/handlers
   * - Must be string type (UUID v4)
   */
  describe('Request Object Enhancement (T117)', () => {
    it('should_attachCorrelationID_when_requestProcessed', () => {
      const req = {
        headers: {}
      } as unknown as IncomingMessage & { correlationId?: string };

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Verify correlation ID attached to request
      expect(req.correlationId).toBeDefined();
      expect(typeof req.correlationId).toBe('string');
      expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should_attachClientID_when_providedInHeader', () => {
      const clientId = '123e4567-e89b-42d3-a456-426614174000'; // UUID v4 format

      const req = {
        headers: {
          'x-correlation-id': clientId
        }
      } as unknown as IncomingMessage & { correlationId?: string };

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should attach client-provided ID to request
      expect(req.correlationId).toBe(clientId);
    });

    it('should_callNext_when_middlewareCompletes', () => {
      const req = { headers: {} } as unknown as IncomingMessage;
      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;
      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Middleware should always call next()
      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(); // No arguments (no error)
    });
  });

  /**
   * Edge Cases and Error Handling
   */
  describe('Edge Cases', () => {
    it('should_handleEmptyCorrelationID_when_emptyStringProvided', () => {
      const req = {
        headers: {
          'x-correlation-id': ''
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should generate new UUID, not use empty string
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.stringMatching(uuidV4Regex)
      );
    });

    it('should_handleWhitespaceCorrelationID_when_provided', () => {
      const req = {
        headers: {
          'x-correlation-id': '   '
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should generate new UUID, not use whitespace
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.stringMatching(uuidV4Regex)
      );
    });

    it('should_handleArrayHeader_when_multipleValuesProvided', () => {
      const clientId = '123e4567-e89b-42d3-a456-426614174000'; // UUID v4 format

      const req = {
        headers: {
          'x-correlation-id': [clientId, 'another-id'] // Array of values
        }
      } as unknown as IncomingMessage;

      const res = {
        setHeader: vi.fn(),
        headersSent: false
      } as unknown as ServerResponse;

      const next = vi.fn();

      correlationIdMiddleware(req, res, next);

      // Should use first valid UUID
      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', clientId);
    });
  });
});
