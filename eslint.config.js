import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'ui/'],
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      indent: 'off',
      'linebreak-style': 'off',
      quotes: 'off',
      semi: 'off',
      'comma-dangle': 'off',
      'quote-props': 'off',
      camelcase: 'off',
      'no-debugger': 'off',

      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',

      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-undef': 'error',
    },
  },
];