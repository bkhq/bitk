import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',

  typescript: true,

  react: true,

  // Use built-in stylistic rules instead of Prettier
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },

  // Disable features we don't use
  vue: false,
  jsonc: false,
  yaml: false,
  toml: false,
  markdown: false,

  ignores: [
    'apps/api/drizzle/**',
    'apps/frontend/src/components/ui/**',
  ],
}, {
  // Custom rule overrides
  rules: {
    // --- relax for existing codebase ---
    'ts/no-explicit-any': 'off',
    'ts/ban-ts-comment': 'off',
    'no-console': 'off',
    'unused-imports/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
    'style/brace-style': ['error', '1tbs'],
    'antfu/if-newline': 'off',
    'antfu/top-level-function': 'off',
    'ts/no-require-imports': 'off',
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'perfectionist/sort-imports': 'off',
    'style/max-statements-per-line': 'off',
    'ts/no-use-before-define': 'off',
    'unicorn/filename-case': 'off',
    'react-refresh/only-export-components': 'off',

    // --- too noisy for existing codebase ---
    'e18e/prefer-static-regex': 'off',
    'regexp/no-unused-capturing-group': 'off',
    'no-alert': 'off',
    'no-cond-assign': 'off',
    'ts/no-this-alias': 'off',
    'unicorn/no-new-array': 'off',
    'style/multiline-ternary': 'off',
    'react-hooks-extra/no-direct-set-state-in-use-effect': 'off',
    'react-naming-convention/ref-name': 'off',
    'react-dom/no-dangerously-set-innerhtml': 'off',
    'react/no-array-index-key': 'off',
    'react-naming-convention/context-name': 'off',
    'react/prefer-use-state-lazy-initialization': 'off',
  },
})
