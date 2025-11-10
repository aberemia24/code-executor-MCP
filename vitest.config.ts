import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 second test timeout
    teardownTimeout: 15000, // 15 seconds for async cleanup
    hookTimeout: 15000, // 15 seconds for hooks
    exclude: [
      '**/node_modules/**',
      '**/dist/**', // Exclude compiled tests to prevent double execution
      '**/*.config.ts',
    ],
    poolOptions: {
      forks: {
        singleFork: true, // Use single fork to avoid worker pool issues
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
      ],
    },
  },
});
