/**
 * Sampling Configuration Validation Tests (FR-7)
 *
 * Tests for sampling configuration schema, defaults, overrides, and environment variables.
 *
 * @see specs/001-mcp-sampling/spec.md (FR-7)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSamplingConfig } from '../src/config.js';
import type { SamplingConfig } from '../src/config-types.js';

describe('Sampling Configuration Validation (FR-7)', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear sampling-related env vars before each test
    delete process.env.CODE_EXECUTOR_SAMPLING_ENABLED;
    delete process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS;
    delete process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS;
    delete process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS;
    delete process.env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED;
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  describe('T072: Valid Sampling Config', () => {
    it('should_validateSamplingConfig_when_validConfigProvided', () => {
      const config = getSamplingConfig();

      expect(config).toBeDefined();
      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.maxRoundsPerExecution).toBe('number');
      expect(typeof config.maxTokensPerExecution).toBe('number');
      expect(typeof config.timeoutPerCallMs).toBe('number');
      expect(Array.isArray(config.allowedSystemPrompts)).toBe(true);
      expect(typeof config.contentFilteringEnabled).toBe('boolean');
    });

    it('should_acceptMinimumValues_when_atLowerBound', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '1';
      process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = '100';
      process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS = '1000';

      const config = getSamplingConfig();

      expect(config.maxRoundsPerExecution).toBe(1);
      expect(config.maxTokensPerExecution).toBe(100);
      expect(config.timeoutPerCallMs).toBe(1000);
    });

    it('should_acceptMaximumValues_when_atUpperBound', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '100';
      process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = '100000';
      process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS = '600000';

      const config = getSamplingConfig();

      expect(config.maxRoundsPerExecution).toBe(100);
      expect(config.maxTokensPerExecution).toBe(100000);
      expect(config.timeoutPerCallMs).toBe(600000);
    });
  });

  describe('T073: Apply Defaults', () => {
    it('should_applyDefaults_when_noConfigProvided', () => {
      // Expected defaults from spec:
      // - enabled: false
      // - maxRoundsPerExecution: 10
      // - maxTokensPerExecution: 10000
      // - timeoutPerCallMs: 30000
      // - allowedSystemPrompts: ['', 'You are a helpful assistant', 'You are a code analysis expert']
      // - contentFilteringEnabled: true

      const config = getSamplingConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxRoundsPerExecution).toBe(10);
      expect(config.maxTokensPerExecution).toBe(10000);
      expect(config.timeoutPerCallMs).toBe(30000);
      expect(config.allowedSystemPrompts).toEqual([
        '',
        'You are a helpful assistant',
        'You are a code analysis expert',
      ]);
      expect(config.contentFilteringEnabled).toBe(true);
    });

    it('should_useDefault_when_emptyString', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '';

      const config = getSamplingConfig();
      expect(config.maxRoundsPerExecution).toBe(10); // Default
    });
  });

  describe('T074: Per-Execution Overrides', () => {
    it('should_supportPerExecutionOverrides_when_parametersProvided', () => {
      // This test validates that execution-level parameters override config
      // The actual override happens in executor code, not config loading
      // We'll test the schema accepts these parameters

      // This test is a placeholder - actual override logic is tested in executor integration tests
      // The config function itself doesn't handle per-execution overrides
      const config = getSamplingConfig();
      expect(config).toBeDefined();
    });

    it('should_allowEnablingSampling_when_globallyDisabled', () => {
      // Per-execution enableSampling parameter should work even if config.enabled = false
      // This is validated in executor tests, not config tests

      // Config returns default (enabled: false), executor will override
      const config = getSamplingConfig();
      expect(config.enabled).toBe(false); // Default
    });
  });

  describe('T075: Environment Variable Overrides', () => {
    it('should_supportEnvVarOverrides_when_envVarsSet', () => {
      process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '20';
      process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = '20000';
      process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS = '60000';
      process.env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED = 'false';

      const config = getSamplingConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxRoundsPerExecution).toBe(20);
      expect(config.maxTokensPerExecution).toBe(20000);
      expect(config.timeoutPerCallMs).toBe(60000);
      expect(config.contentFilteringEnabled).toBe(false);
    });

    it('should_mixEnvVarsAndDefaults_when_partialEnvSet', () => {
      process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
      // Other vars not set - should use defaults

      const config = getSamplingConfig();

      expect(config.enabled).toBe(true); // From env
      expect(config.maxRoundsPerExecution).toBe(10); // Default
      expect(config.maxTokensPerExecution).toBe(10000); // Default
      expect(config.timeoutPerCallMs).toBe(30000); // Default
    });

    it('should_parseBoolean_when_envVarIsString', () => {
      process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
      process.env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED = 'false';

      const config = getSamplingConfig();

      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.contentFilteringEnabled).toBe('boolean');
      expect(config.enabled).toBe(true);
      expect(config.contentFilteringEnabled).toBe(false);
    });
  });

  describe('Invalid Configuration', () => {
    it('should_throwZodError_when_negativeRounds', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '-1';

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_throwZodError_when_zeroRounds', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '0';

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_throwZodError_when_negativeTokens', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = '-100';

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_throwZodError_when_timeoutTooShort', () => {
      process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS = '500'; // Min should be 1000

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_throwZodError_when_timeoutTooLong', () => {
      process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS = '600001'; // Max should be 600000

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_throwZodError_when_nonNumericRounds', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = 'invalid';

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_throwZodError_when_invalidBoolean', () => {
      process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'notaboolean';

      expect(() => getSamplingConfig()).toThrow();
    });
  });

  describe('Bounds Checking', () => {
    it('should_enforceLowerBound_for_maxRounds', () => {
      const testValues = ['-1', '0'];

      testValues.forEach((value) => {
        process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = value;
        expect(() => getSamplingConfig()).toThrow();
      });
    });

    it('should_enforceUpperBound_for_maxRounds', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = '101'; // Max should be 100

      expect(() => getSamplingConfig()).toThrow();
    });

    it('should_enforceLowerBound_for_maxTokens', () => {
      const testValues = ['-1', '0', '99']; // Min should be 100

      testValues.forEach((value) => {
        process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = value;
        expect(() => getSamplingConfig()).toThrow();
      });
    });

    it('should_enforceUpperBound_for_maxTokens', () => {
      process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = '100001'; // Max should be 100000

      expect(() => getSamplingConfig()).toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should_returnCorrectTypes_for_allFields', () => {
      const config = getSamplingConfig();

      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.maxRoundsPerExecution).toBe('number');
      expect(typeof config.maxTokensPerExecution).toBe('number');
      expect(typeof config.timeoutPerCallMs).toBe('number');
      expect(typeof config.contentFilteringEnabled).toBe('boolean');
      expect(Array.isArray(config.allowedSystemPrompts)).toBe(true);
    });

    it('should_returnIntegers_for_numericFields', () => {
      const config = getSamplingConfig();

      expect(Number.isInteger(config.maxRoundsPerExecution)).toBe(true);
      expect(Number.isInteger(config.maxTokensPerExecution)).toBe(true);
      expect(Number.isInteger(config.timeoutPerCallMs)).toBe(true);
    });
  });
});
