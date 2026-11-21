import { defineConfig } from 'vitest/config';

// Integration tests require PostgreSQL reachable via TEST_DATABASE_URL
// (default: the local-only Compose db binding 127.0.0.1:5432).
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000
  }
});
