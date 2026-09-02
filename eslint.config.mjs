import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', 'auth-server/**', 'main.js', 'main/**/*.js', 'renderer/**', 'styles/**', 'index.html', 'activation.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/infrastructure/xingtu/gateway.ts', 'src/main/services/licenseGateway.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);