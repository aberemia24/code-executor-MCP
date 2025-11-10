import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    teardownTimeout: 10000, // Give 10 seconds for async cleanup
    exclude: [
      '**/node_modules/**',
      '**/dist/**', // Exclude compiled tests to prevent double execution
      '**/*.config.ts',
    ],
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
