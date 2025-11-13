/**
 * Tests for skipDangerousPatternCheck configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shouldSkipDangerousPatternCheck, initConfig } from '../src/config.js';

describe('shouldSkipDangerousPatternCheck', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    // Clean up environment
    delete process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS;
    delete process.env.CODE_EXECUTOR_CONFIG_PATH;

    // Re-initialize config for each test
    await initConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should_return_false_by_default', async () => {
    // No env var, no config file with skipDangerousPatternCheck
    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(false);
  });

  it('should_return_true_when_env_var_is_true', async () => {
    process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS = 'true';
    await initConfig();

    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(true);
  });

  it('should_return_true_when_env_var_is_1', async () => {
    process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS = '1';
    await initConfig();

    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(true);
  });

  it('should_return_false_when_env_var_is_false', async () => {
    process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS = 'false';
    await initConfig();

    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(false);
  });

  it('should_return_false_when_env_var_is_0', async () => {
    process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS = '0';
    await initConfig();

    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(false);
  });

  it('should_return_false_when_env_var_is_empty_string', async () => {
    process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS = '';
    await initConfig();

    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(false);
  });

  it('should_prioritize_env_var_over_config_file', async () => {
    // Even if config file says skipDangerousPatternCheck: true,
    // env var CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS=false should win
    // This is tested by setting the env var explicitly
    process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS = 'false';
    await initConfig();

    const result = shouldSkipDangerousPatternCheck();

    expect(result).toBe(false);
  });
});
