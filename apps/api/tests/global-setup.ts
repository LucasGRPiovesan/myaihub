import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { GlobalSetupContext } from 'vitest/node';
import { env } from '../src/config/env.js';
import { TEST_WORKER_COUNT, databaseUrlForWorker, resetSlots } from './helpers/worker-db.js';

const run = promisify(execFile);

/** O schema.prisma é resolvido a partir do cwd — que não é necessariamente apps/api. */
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

declare module 'vitest' {
  export interface ProvidedContext {
    /** Falso quando não há banco de teste disponível — as suítes de integração se pulam. */
    integrationDatabaseReady: boolean;
  }
}

const MISSING_URL_MESSAGE =
  'TEST_DATABASE_URL não configurada.\n' +
  'Os testes de integração truncam tabelas, então apontá-los para o banco de\n' +
  'desenvolvimento apagaria seus dados. Defina no .env:\n' +
  '  TEST_DATABASE_URL="mysql://myaihub:myaihub@localhost:3306/myaihub_test"';

/**
 * Aplica as migrações no banco de teste antes da suíte — uma vez por execução.
 *
 * Fora de CI, banco indisponível apenas PULA os testes de integração: o
 * desenvolvedor pode estar sem o Docker no ar e ainda assim precisa rodar os
 * testes unitários. Em CI, a mesma situação é ERRO — suíte de integração pulada
 * silenciosamente é pior do que suíte vermelha.
 */
export default async function setup({ provide }: GlobalSetupContext): Promise<void> {
  const isCi = Boolean(process.env['CI']);

  if (!env.TEST_DATABASE_URL) {
    if (isCi) throw new Error(`CI exige testes de integração.\n\n${MISSING_URL_MESSAGE}`);
    console.warn(`\n⚠ ${MISSING_URL_MESSAGE}\n  Testes de integração serão pulados.\n`);
    provide('integrationDatabaseReady', false);
    return;
  }

  resetSlots();

  try {
    // Um banco por worker, migrados em PARALELO. `migrate deploy` cria o banco
    // se ele não existir, então não há passo de CREATE DATABASE à parte — e
    // não há SQL cru, que o lint barra com razão.
    await Promise.all(
      Array.from({ length: TEST_WORKER_COUNT }, (_, index) =>
        run('npx', ['prisma', 'migrate', 'deploy'], {
          cwd: apiRoot,
          shell: process.platform === 'win32',
          env: {
            ...process.env,
            DATABASE_URL: databaseUrlForWorker(env.TEST_DATABASE_URL!, index + 1),
          },
        }),
      ),
    );
    provide('integrationDatabaseReady', true);
  } catch (error) {
    if (isCi) throw error;

    // Sem o motivo, este aviso viraria um mistério recorrente.
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    console.warn(
      '\n⚠ Banco de teste indisponível — testes de integração serão pulados.\n' +
        '  Suba a infraestrutura com `npm run docker:up` e rode de novo.\n' +
        (detail ? `\n  Motivo:\n${detail.replace(/^/gm, '  ')}\n` : ''),
    );
    provide('integrationDatabaseReady', false);
  }
}
