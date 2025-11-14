import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 second test timeout
    teardownTimeout: 30000, // 30 seconds for async cleanup (CI needs more time)
    hookTimeout: 30000, // 30 seconds for hooks
    exclude: [
      '**/node_modules/**',
      '**/dist/**', // Exclude compiled tests to prevent double execution
      '**/*.config.ts',
    ],
    pool: 'threads', // Use threads instead of forks for better memory management
    poolOptions: {
      threads: {
        singleThread: true, // Use single thread to prevent memory accumulation
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        '**/*.config.ts',
        '**/*.test.ts',
        'examples/**',
        'tests/helpers/**', // Exclude test utilities from coverage
      ],
      // Coverage thresholds for production readiness features
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
        // Security-critical components require 95%+ coverage
        // NOTE: These files don't exist yet (Phase 3 implementation)
        // Pre-configured thresholds ensure TDD compliance from day 1
        // When files are created, these thresholds automatically apply
        'src/http-auth-middleware.ts': {
          lines: 98,    // 98% for security-critical authentication
          functions: 98,
          branches: 95,
          statements: 98,
        },
        'src/per-client-rate-limiter.ts': {
          lines: 95,    // 95% for rate limiting (DDoS prevention)
          functions: 95,
          branches: 90,
          statements: 95,
        },
        'src/circuit-breaker-factory.ts': {
          lines: 95,    // 95% for fault isolation (cascading failures)
          functions: 95,
          branches: 90,
          statements: 95,
        },
      },
    },
  },
});
