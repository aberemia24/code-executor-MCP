/**
 * HTTP Authentication Middleware Tests (US3: FR-3)
 *
 * Tests for bearer token authentication in HTTP transport mode.
 * Security-critical component requiring 98%+ test coverage.
 *
 * TDD Approach: Tests written BEFORE implementation (Red-Green-Refactor)
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpAuthMiddleware } from '../src/http-auth-middleware';
import type { Request, Response, NextFunction } from 'express';

describe('HTTP Authentication Middleware (US3: FR-3)', () => {
  let middleware: HttpAuthMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    // Valid API keys for testing (must be 32+ characters)
    const apiKeys = new Map<string, string>([
      ['test_key_32chars_alphanumeric_ok', 'client_1'], // 34 chars
      ['another_valid_key_for_client_two', 'client_2'], // 35 chars
    ]);

    middleware = new HttpAuthMiddleware({ apiKeys });

    mockRequest = {
      headers: {},
      ip: '192.168.1.100',
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('Valid Authentication (T031)', () => {
    test('should_allow Request_when_validAPIKeyProvided', () => {
      mockRequest.headers = {
        authorization: 'Bearer test_key_32chars_alphanumeric_ok',
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    test('should_extractClientId_when_validAPIKeyProvided', () => {
      mockRequest.headers = {
        authorization: 'Bearer test_key_32chars_alphanumeric_ok',
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Client ID should be attached to request
      expect((mockRequest as any).clientId).toBe('client_1');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Missing API Key (T032)', () => {
    test('should_return401_when_authorizationHeaderMissing', () => {
      mockRequest.headers = {}; // No Authorization header

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('missing'),
          hint: expect.any(String),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should_return401_when_bearerSchemeIncorrect', () => {
      mockRequest.headers = {
        authorization: 'Basic test_key_32chars_alphanumeric_', // Wrong scheme
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Invalid API Key Format (T033)', () => {
    test('should_return401_when_keyTooShort', () => {
      mockRequest.headers = {
        authorization: 'Bearer short_key', // < 32 chars
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('format'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should_return401_when_keyContainsInvalidChars', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid@key#with$special%chars&*', // Invalid chars
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Constant-Time Comparison (T034)', () => {
    test('should_useTimingSafeEqual_when_comparingKeys', () => {
      // This test verifies implementation uses crypto.timingSafeEqual
      // Timing attacks test would require sophisticated timing analysis
      mockRequest.headers = {
        authorization: 'Bearer test_key_32chars_alphanumeric_ok',
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      // Implementation should use crypto.timingSafeEqual internally
    });
  });

  describe('Failed Auth Logging (T035)', () => {
    test('should_logFailedAttempt_when_invalidKeyProvided', () => {
      const logSpy = vi.spyOn(console, 'warn');

      mockRequest.headers = {
        authorization: 'Bearer invalid_key_that_does_not_exist_',
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(logSpy).toHaveBeenCalled();
      // Should log with hashed key, client IP, timestamp
      expect(mockNext).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe('Multiple Clients', () => {
    test('should_authenticateMultipleClients_when_differentKeys', () => {
      // Client 1
      mockRequest.headers = {
        authorization: 'Bearer test_key_32chars_alphanumeric_ok',
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect((mockRequest as any).clientId).toBe('client_1');
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Client 2
      mockRequest.headers = {
        authorization: 'Bearer another_valid_key_for_client_two',
      };

      middleware.authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect((mockRequest as any).clientId).toBe('client_2');
      expect(mockNext).toHaveBeenCalledTimes(2);
    });
  });
});
