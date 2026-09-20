import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './client.js';

/**
 * Quais migrações existem no repositório e ainda não foram aplicadas.
 *
 * Isto existe porque a checagem anterior olhava para o lugar errado: ela
 * consultava uma tabela da PRIMEIRA migração e concluía "schema aplicado".
 * Migração NOVA num banco que já tem schema passava batido — a API subia
 * saudável e quebrava depois, na primeira query que tocasse a coluna nova, com
 * um erro do Prisma longe da causa. Aconteceu várias vezes nesta base, e a
 * saída era sempre a mesma: lembrar de rodar `db:migrate:deploy` à mão.
 *
 * A leitura é o cruzamento de duas listas: as pastas em `prisma/migrations` e
 * os nomes gravados em `_prisma_migrations`. Barata o bastante para rodar em
 * todo boot — o alternativo seria invocar o CLI do Prisma, que custa segundos
 * em cada restart do `tsx watch`.
 */
export interface PendingMigrations {
  pending: string[];
  /** O banco não tem nem a tabela de controle: schema inteiro ausente. */
  virgin: boolean;
}

/** As pastas de migração do repositório, em ordem — o nome é o carimbo de tempo. */
export function migrationsOnDisk(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // Sem a pasta não há o que aplicar. Acontece em build que não a copia — e
    // aí o certo é seguir, não derrubar o boot.
    return [];
  }
}

export function migrationsDir(): string {
  // O CWD é a raiz do monorepo em `npm run dev`, e `apps/api` quando o script
  // roda pelo workspace. Normalizar aqui evita um caminho certo em um caso e
  // errado no outro.
  const root = process.cwd().replace(/[\\/]apps[\\/]api$/, '');
  return join(root, 'apps', 'api', 'prisma', 'migrations');
}

/**
 * `_prisma_migrations` não existe — banco novo, não banco quebrado.
 *
 * O MySQL responde 1146 para tabela ausente; o Prisma embrulha isso num erro
 * de query crua. Reconhecer o caso pelo código é o que separa "nunca migrou"
 * de "não consigo falar com o banco".
 */
function isMissingTable(error: unknown): boolean {
  const mensagem = error instanceof Error ? error.message : String(error ?? '');
  return mensagem.includes('1146') || /doesn't exist|does not exist/i.test(mensagem);
}

/**
 * Compara o que está no disco com o que o banco diz ter aplicado.
 *
 * `$queryRaw` aqui é a exceção que a regra do lint prevê: `_prisma_migrations`
 * é a contabilidade do próprio Prisma, não é modelo do domínio, não tem
 * `accountId` e não é alcançável pelo client tipado. A consulta é fechada — sem
 * parâmetro, sem interpolação, quatro linhas de leitura — e roda no boot, antes
 * de existir requisição ou tenant. Ver o teste de isolamento em
 * `pending-migrations.test.ts`.
 */
export async function findPendingMigrations(db: Db): Promise<PendingMigrations> {
  const onDisk = migrationsOnDisk(migrationsDir());
  if (onDisk.length === 0) return { pending: [], virgin: false };

  let applied: string[];

  try {
    // tenant-reviewed: tabela de controle do Prisma, sem tenant e sem parâmetro.
    // eslint-disable-next-line no-restricted-syntax
    const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    applied = rows.map((row) => row.migration_name);
  } catch (error) {
    // SÓ a ausência da tabela conta como banco novo.
    //
    // Engolir qualquer erro aqui transformaria "banco inacessível" e
    // "credencial errada" em "vou migrar do zero" — e o boot tentaria
    // aplicar migração contra um banco que ele nem alcança, trocando um erro
    // claro de conexão por um erro de migração que não explica nada.
    if (!isMissingTable(error)) throw error;

    // Sem a tabela de controle, nada foi aplicado — banco novo ou volume
    // recriado. Não é erro: é o caso que o boot existe para resolver.
    return { pending: onDisk, virgin: true };
  }

  const aplicadas = new Set(applied);
  return { pending: onDisk.filter((name) => !aplicadas.has(name)), virgin: false };
}
