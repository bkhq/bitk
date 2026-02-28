import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    typescript: true,
    stylistic: false,
    ignores: [
      'node_modules',
      '*.json',
    ],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'off',
      'node/prefer-global/process': 'off',
    },
  },
)
