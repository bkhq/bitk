import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.out/**',
      '**/.wrangler/**',
      '**/.turbo/**',
      '**/.cache/**',
      'apps/api/drizzle/**',
      'apps/frontend/src/components/ui/**',
    ],
  },

  eslint.configs.recommended,

  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // --- style (from biome style rules) ---
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      'prefer-const': 'error',

      // --- suspicious ---
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-debugger': 'error',
      'no-dupe-keys': 'warn',

      // --- performance ---
      'no-restricted-syntax': [
        'error',
        {
          selector: "UnaryExpression[operator='delete']",
          message: 'The `delete` operator is slow. Use Map/Set or set to undefined instead.',
        },
      ],

      // --- correctness ---
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // --- promises (from biome nursery — warn until codebase is cleaned up) ---
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true, ignoreIIFE: true }],
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: false }],

      // --- relax rules not in original biome config ---
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
    },
  },

  // React-specific rules for frontend
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // New react-hooks v7 rules — not in original biome config, disable for now
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Disable type-checked rules for JS config files
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Prettier must be last to override formatting rules
  eslintConfigPrettier,
)
