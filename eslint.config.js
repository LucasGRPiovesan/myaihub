// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.tsbuild/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'apps/api/prisma/migrations/**',
      'apps/web/src/vite-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // ---------------------------------------------------------------------------
  // Guardrail de arquitetura: domínio e aplicação não conhecem Prisma nem SDKs
  // de provider. Ver docs/ARCHITECTURE.md §1.6 e §2.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/api/src/**/domain/**/*.ts', 'apps/api/src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/client',
                '**/prisma/**',
                '../infrastructure/*',
                '**/infrastructure/**',
              ],
              message:
                'domain/application não podem depender de Prisma nem de infraestrutura. Declare um port e injete a implementação.',
            },
            {
              group: ['@google/genai', 'openai', '@anthropic-ai/*'],
              message:
                'SDKs de provider só podem ser importados em modules/ai/infrastructure/providers.',
            },
            {
              group: ['express'],
              message: 'HTTP pertence à camada de presentation.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Guardrail de tenant isolation: raw SQL escapa do tenantGuard do Prisma.
  // Ver docs/ARCHITECTURE.md §12.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[property.name=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]',
          message:
            'Raw SQL escapa do tenantGuard. Se for realmente necessário, adicione `// tenant-reviewed: <motivo>` e um teste de isolamento dedicado, e desabilite esta regra pontualmente.',
        },
      ],
    },
  },

  // Seeds e scripts precisam do client cru, com SystemTenantContext explícito.
  {
    files: ['apps/api/prisma/**/*.ts', 'apps/api/src/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/*.fixtures.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Teste de use case precisa montar o grafo real — inclusive as
      // implementações de infraestrutura. A regra de camadas protege o código
      // de produção; aplicá-la aqui só forçaria dublês onde o real serve melhor.
      'no-restricted-imports': 'off',
    },
  },

  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
