import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedVarsOptions = {
    varsIgnorePattern: '^_',
    argsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_'
};

export default defineConfig([
    {
        ignores: ['node_modules/**', 'coverage/**', 'dist/**']
    },
    {
        files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: Object.assign({}, globals.node, globals.es2022)
        },
        rules: {
            // Error detection
            'for-direction': 'error',
            'no-await-in-loop': 'error',
            'no-div-regex': 'error',
            eqeqeq: 'error',
            'dot-notation': 'error',
            curly: 'error',
            'no-fallthrough': 'error',
            'no-unused-expressions': [
                'error',
                {
                    allowShortCircuit: true
                }
            ],
            'no-unused-vars': ['error', unusedVarsOptions],
            'handle-callback-err': 'error',
            'no-new': 'error',
            'new-cap': 'error',
            'no-eval': 'error',
            'no-invalid-this': 'error',
            radix: ['error', 'always'],
            'no-use-before-define': ['error', 'nofunc'],
            'callback-return': ['error', ['callback', 'cb', 'done']],
            'no-regex-spaces': 'error',
            'no-empty': 'error',
            'no-duplicate-case': 'error',
            'no-empty-character-class': 'error',
            'no-redeclare': 'off', // Disabled per project preference
            'block-scoped-var': 'error',
            'no-sequences': 'error',
            'no-throw-literal': 'error',
            'no-useless-call': 'error',
            'no-useless-concat': 'error',
            'no-void': 'error',
            yoda: 'error',
            'no-undef': 'error',
            'no-var': 'error',
            'no-bitwise': 'error',
            'no-lonely-if': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'arrow-parens': ['error', 'as-needed'],
            'prefer-arrow-callback': 'error',
            'object-shorthand': 'error',
            'prefer-spread': 'error',
            'no-prototype-builtins': 'off', // Disabled per project preference
            strict: ['error', 'global']
        }
    },
    {
        files: ['**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs'
        }
    },
    {
        files: ['**/*.ts'],
        extends: [tseslint.configs.recommended],
        rules: {
            // Handled by the TypeScript compiler
            'no-undef': 'off',
            // TypeScript-aware replacements for the base rules
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions],
            'no-unused-expressions': 'off',
            '@typescript-eslint/no-unused-expressions': [
                'error',
                {
                    allowShortCircuit: true
                }
            ],
            'no-use-before-define': 'off',
            '@typescript-eslint/no-use-before-define': [
                'error',
                {
                    functions: false,
                    classes: true,
                    variables: true,
                    typedefs: false,
                    ignoreTypeReferences: true
                }
            ],
            'no-invalid-this': 'off',
            '@typescript-eslint/no-invalid-this': 'error',
            // Project preferences
            'prefer-const': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-namespace': 'off'
        }
    },
    prettier
]);
