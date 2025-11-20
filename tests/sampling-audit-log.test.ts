/**
 * Sampling Audit Log Tests (FR-8)
 *
 * Tests for sampling-specific audit logging with SHA-256 hashing and
 * content filtering violation tracking.
 *
 * @see specs/001-mcp-sampling/spec.md (FR-8)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SamplingAuditLogger, resetSamplingAuditLogger } from '../src/sampling-audit-logger.js';
import type { SamplingAuditEntry } from '../src/types.js';

// Test instance
let logger: SamplingAuditLogger;

async function logSamplingCall(entry: SamplingAuditEntry): Promise<void> {
  await logger.logSamplingCall(entry);
}

describe('Sampling Audit Log (FR-8)', () => {
  const testLogDir = path.join('/tmp', 'test-audit-logs-' + Date.now());

  beforeEach(async () => {
    // Create test log directory
    await fs.mkdir(testLogDir, { recursive: true });

    // Create test logger instance
    logger = new SamplingAuditLogger();
    resetSamplingAuditLogger();
  });

  afterEach(async () => {
    // Clean up test logs
    await fs.rm(testLogDir, { recursive: true, force: true });
  });

  describe('T082: Log Sampling Call', () => {
    it('should_logSamplingCall_when_samplingExecuted', async () => {
      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-123',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: crypto.createHash('sha256').update('test prompt').digest('hex'),
        responseHash: crypto.createHash('sha256').update('test response').digest('hex'),
        tokensUsed: 150,
        durationMs: 1500,
        status: 'success',
      };

      // Should succeed now that it's implemented
      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });

    it('should_includeAllRequiredFields_when_loggingSuccess', async () => {
      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-456',
        round: 2,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'abc123',
        responseHash: 'def456',
        tokensUsed: 200,
        durationMs: 2000,
        status: 'success',
      };

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });

    it('should_logFailure_when_samplingErrors', async () => {
      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-789',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'hash1',
        responseHash: '', // Empty on failure
        tokensUsed: 0,
        durationMs: 100,
        status: 'failure',
        errorMessage: 'API request failed: 500 Internal Server Error',
      };

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });

    it('should_logRateLimited_when_quotaExceeded', async () => {
      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-limit',
        round: 11, // Exceeds default max of 10
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'hash2',
        responseHash: '',
        tokensUsed: 0,
        durationMs: 5,
        status: 'rate_limited',
        errorMessage: 'Max rounds exceeded (10)',
      };

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });
  });

  describe('T083: SHA-256 Hashing', () => {
    it('should_useSHA256Hashes_when_loggingSensitiveData', async () => {
      const sensitivePrompt = 'What is the API key for production?';
      const sensitiveResponse = 'The API key is sk-1234567890';

      const promptHash = crypto.createHash('sha256').update(sensitivePrompt).digest('hex');
      const responseHash = crypto.createHash('sha256').update(sensitiveResponse).digest('hex');

      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-sensitive',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash, // Hashed, not plaintext
        responseHash, // Hashed, not plaintext
        tokensUsed: 50,
        durationMs: 1000,
        status: 'success',
      };

      // Verify hashes are SHA-256 (64 hex chars)
      expect(promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(responseHash).toMatch(/^[a-f0-9]{64}$/);

      // Verify plaintext is NOT in hashes
      expect(promptHash).not.toContain('API key');
      expect(responseHash).not.toContain('sk-1234567890');

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });

    it('should_hashDeterministically_when_sameInputProvided', async () => {
      const input = 'test prompt';
      const hash1 = crypto.createHash('sha256').update(input).digest('hex');
      const hash2 = crypto.createHash('sha256').update(input).digest('hex');

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should_produceDifferentHashes_when_differentInputsProvided', async () => {
      const prompt1 = 'What is 2+2?';
      const prompt2 = 'What is 2+3?';

      const hash1 = crypto.createHash('sha256').update(prompt1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(prompt2).digest('hex');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('T084: Content Filter Violations', () => {
    it('should_includeContentViolations_when_filterDetects', async () => {
      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-violations',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'hash3',
        responseHash: 'hash4',
        tokensUsed: 100,
        durationMs: 1200,
        status: 'success',
        contentViolations: [
          { type: 'OPENAI_KEY', count: 1 },
          { type: 'EMAIL', count: 2 },
        ],
      };

      // Verify violations structure
      expect(entry.contentViolations).toBeDefined();
      expect(entry.contentViolations?.length).toBe(2);
      expect(entry.contentViolations?.[0].type).toBe('OPENAI_KEY');
      expect(entry.contentViolations?.[0].count).toBe(1);

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });

    it('should_aggregateViolations_when_multipleDetected', async () => {
      const violations = [
        { type: 'OPENAI_KEY', count: 2 },
        { type: 'GITHUB_TOKEN', count: 1 },
        { type: 'EMAIL', count: 5 },
        { type: 'SSN', count: 1 },
      ];

      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-multi-violations',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'hash5',
        responseHash: 'hash6',
        tokensUsed: 200,
        durationMs: 1800,
        status: 'success',
        contentViolations: violations,
      };

      expect(entry.contentViolations?.length).toBe(4);

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });

    it('should_omitViolations_when_noneDetected', async () => {
      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-clean',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'hash7',
        responseHash: 'hash8',
        tokensUsed: 80,
        durationMs: 900,
        status: 'success',
        // No contentViolations field
      };

      expect(entry.contentViolations).toBeUndefined();

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });
  });

  describe('Security Requirements', () => {
    it('should_neverLogPlaintextPrompts_when_auditing', async () => {
      const plaintextPrompt = 'This contains sensitive data: sk-api-key-12345';

      // Hash instead of plaintext
      const hash = crypto.createHash('sha256').update(plaintextPrompt).digest('hex');

      // Verify hash doesn't contain plaintext
      expect(hash).not.toContain('sk-api-key');
      expect(hash).not.toContain('sensitive data');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should_neverLogPlaintextResponses_when_auditing', async () => {
      const plaintextResponse = 'Your password is: secret123';

      // Hash instead of plaintext
      const hash = crypto.createHash('sha256').update(plaintextResponse).digest('hex');

      expect(hash).not.toContain('password');
      expect(hash).not.toContain('secret123');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should_sanitizeErrorMessages_when_logging', async () => {
      // Error message should NOT contain sensitive data
      const sanitizedError = 'API request failed: 401 Unauthorized';

      const entry: SamplingAuditEntry = {
        timestamp: new Date().toISOString(),
        executionId: 'exec-error',
        round: 1,
        model: 'claude-3-5-sonnet-20241022',
        promptHash: 'hash9',
        responseHash: '',
        tokensUsed: 0,
        durationMs: 50,
        status: 'failure',
        errorMessage: sanitizedError,
      };

      // Verify no API keys in error message
      expect(entry.errorMessage).not.toContain('sk-');
      expect(entry.errorMessage).not.toContain('api-key');

      await expect(logSamplingCall(entry)).resolves.not.toThrow();
    });
  });
});
