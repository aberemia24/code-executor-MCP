
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSamplingConfig } from '../src/config/loader.js';

// Mock process.env
const originalEnv = process.env;

describe('Issue #69: Provider-Specific Model Allowlists', () => {
    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should use default models if no env vars set', () => {
        process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
        const config = getSamplingConfig();
        expect(config.allowedModels).toBeDefined();
        expect(config.allowedModels.length).toBeGreaterThan(0);
        expect(config.allowedModels).toContain('gpt-4o-mini');
    });

    it('should use global allowed models if set', () => {
        process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
        process.env.CODE_EXECUTOR_ALLOWED_MODELS = 'global-model-1, global-model-2';

        const config = getSamplingConfig();
        expect(config.allowedModels).toEqual(['global-model-1', 'global-model-2']);
    });

    it('should use provider-specific allowed models if set', () => {
        process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
        process.env.CODE_EXECUTOR_AI_PROVIDER = 'openai';
        process.env.CODE_EXECUTOR_ALLOWED_MODELS_OPENAI = 'gpt-4-turbo, gpt-3.5-turbo';
        // Global should be ignored if provider specific is set? 
        // My logic: providerModels || global
        process.env.CODE_EXECUTOR_ALLOWED_MODELS = 'global-model';

        const config = getSamplingConfig();
        expect(config.allowedModels).toEqual(['gpt-4-turbo', 'gpt-3.5-turbo']);
    });

    it('should fallback to global if provider-specific not set', () => {
        process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
        process.env.CODE_EXECUTOR_AI_PROVIDER = 'openai';
        // No OPENAI specific list
        process.env.CODE_EXECUTOR_ALLOWED_MODELS = 'global-model';

        const config = getSamplingConfig();
        expect(config.allowedModels).toEqual(['global-model']);
    });

    it('should handle different providers', () => {
        process.env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
        process.env.CODE_EXECUTOR_AI_PROVIDER = 'gemini';
        process.env.CODE_EXECUTOR_ALLOWED_MODELS_GEMINI = 'gemini-pro';

        const config = getSamplingConfig();
        expect(config.allowedModels).toEqual(['gemini-pro']);
    });
});
