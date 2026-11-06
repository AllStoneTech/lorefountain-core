/**
 * Vitest configuration for LoreFountain-Core's unit tests. Everything here
 * is pure: text in, data out, plus read-only file access for manifests.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
