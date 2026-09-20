import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { env, isProduction } from '../../../config/env.js';
import { runSeed } from '../../../scripts/seed.js';
import type { Logger } from '../../application/ports.js';
import type { Db } from './client.js';
import { findPendingMigrations } from './pending-migrations.js';
import { assertSchemaApplied, SchemaNotAppliedError } from './schema-check.js';

const run = promisify(execFile);

/**
 * Deixa o banco utilizável antes de a API aceitar requisição.
 *
 * Em DESENVOLVIMENTO isto é automático porque o modo de falha real é chato e
 * recorrente: derrubar e subir o container recria o volume do MySQL, o schema
 * some, e o login passa a responder erro até alguém lembrar de rodar migração e
 * seed à mão. Nada disso é decisão — é ritual, e ritual pertence ao código.
 *
 * Em PRODUÇÃO nada é automático:
 *
 *   migração  é passo de deploy, com janela e rollback pensados. Aplicar schema
 *             sozinho no start significa que subir uma réplica altera o banco.
 *   seed      criaria um admin com senha padrão conhecida. Isso não é
 *             conveniência, é porta aberta.
 *
 * Lá o boot apenas VERIFICA e se recusa a subir com o schema errado.
 */
export async function ensureDatabaseReady(db: Db, logger: Logger): Promise<void> {
  if (isProduction) {
    await assertSchemaApplied(db, logger);
    return;
  }

  // MIGRAÇÃO PENDENTE, não só schema ausente.
  //
  // A checagem anterior olhava para uma tabela da PRIMEIRA migração: com o
  // schema existente, ela dizia "tudo certo" e a migração nova ficava para
  // trás. A API subia saudável e quebrava depois, na primeira query que
  // tocasse a coluna nova — erro do Prisma longe da causa, e a saída era
  // sempre lembrar de rodar `db:migrate:deploy` à mão.
  const { pending, virgin } = await findPendingMigrations(db);

  if (pending.length > 0) {
    logger.warn(
      { pendentes: pending, banco: virgin ? 'sem schema' : 'desatualizado' },
      'migrações pendentes — aplicando antes de aceitar requisição',
    );
    await applyMigrations(logger);
  }

  // A verificação continua: aplicar migração é uma coisa, o banco responder
  // ao schema que o código espera é outra — e é a segunda que faz o login
  // funcionar.
  await assertSchemaApplied(db, logger);

  // Sempre, não só quando o schema faltava: um banco com schema e sem usuário
  // dá exatamente o mesmo sintoma — "não consigo entrar" — e é indistinguível
  // do outro caso para quem está usando.
  await runSeed(db, { quiet: true });
}

/**
 * `prisma migrate deploy`, não `dev`.
 *
 * `deploy` só aplica o que já existe em `migrations/`; `dev` compara o schema e
 * PODE resetar o banco para resolver drift. Subir a API nunca pode ser um
 * caminho para perder dados, mesmo em desenvolvimento.
 */
async function applyMigrations(logger: Logger): Promise<void> {
  // O CLI é invocado pelo próprio Node, não por `npx`: no Windows o `execFile`
  // recusa arquivos `.cmd` desde a mudança de segurança do Node (`spawn
  // EINVAL`), e usar `shell: true` para contornar abriria interpolação de shell
  // só para rodar uma migração.
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');

  try {
    const { stdout } = await run(
      process.execPath,
      [cli, 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'],
      {
        cwd: process.cwd().replace(/[\\/]apps[\\/]api$/, ''),
        env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
      },
    );

    logger.info(
      { migrations: stdout.match(/\d+ migrations?/)?.[0] ?? 'aplicadas' },
      'migrações aplicadas no boot',
    );
  } catch (error) {
    throw new SchemaNotAppliedError(
      `não foi possível aplicar as migrações automaticamente ` +
        `(${error instanceof Error ? error.message.slice(0, 200) : 'erro desconhecido'})`,
    );
  }
}
