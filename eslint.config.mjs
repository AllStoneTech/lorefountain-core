// Flat ESLint configuration for LoreFountain-Core, matching the extension's
// rules: typescript-eslint recommended, single quotes, semicolons, and a
// warning on `any`.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'out/', 'node_modules/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
    },
  },
);
