import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  findPendingMigrations,
  migrationsDir,
  migrationsOnDisk,
} from '../src/shared/infrastructure/prisma/pending-migrations.js';
import { getDb } from '../src/shared/infrastructure/prisma/client.js';
import {
  runWithTenantContext,
  systemTenantContext,
} from '../src/shared/application/tenant-context.js';
import { closeTestResources, rawDb } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

/**
 * A leitura de `_prisma_migrations` é a ÚNICA consulta crua do sistema.
 *
 * A regra do lint exige, para uma exceção dessas, um teste de isolamento
 * dedicado — e é o que este arquivo é. O que ele prova: a consulta não toca
 * dado de conta nenhuma, não aceita parâmetro, e responde a mesma coisa com ou
 * sem contexto de tenant, porque não há tenant envolvido.
 *
 * Se um dia alguém a ampliar para ler outra tabela, este teste não protege mais
 * nada — e a exceção precisa ser revista, não estendida.
 */
describe.skipIf(!enabled)('leitura das migrações aplicadas', () => {
  beforeEach(() => {
    // Sem `resetDatabase`: truncar as tabelas do domínio não muda a
    // contabilidade do Prisma, que é justamente o ponto.
  });

  afterAll(async () => {
    await closeTestResources();
  });

  it('lê o que o disco tem e o banco confirma — sem pendência num banco em dia', async () => {
    const resultado = await findPendingMigrations(getDb());

    // A suíte roda contra um banco migrado: se houvesse pendência aqui, os
    // outros arquivos de integração estariam falhando por coluna ausente.
    expect(resultado.virgin).toBe(false);
    expect(resultado.pending).toEqual([]);
  });

  it('as pastas do disco são a fonte da lista', () => {
    const pastas = migrationsOnDisk(migrationsDir());

    expect(pastas.length).toBeGreaterThan(0);
    // Ordenadas: o nome começa pelo carimbo de tempo, e é essa ordem que o
    // `migrate deploy` respeita.
    expect([...pastas].sort()).toEqual(pastas);
  });

  it('NÃO depende de contexto de tenant — não há tenant nesta tabela', async () => {
    const semContexto = await findPendingMigrations(getDb());

    const comContexto = await runWithTenantContext(
      systemTenantContext('Teste de isolamento da leitura de migrações.'),
      () => findPendingMigrations(getDb()),
    );

    // O tenantGuard não tem o que barrar aqui, e é isso que torna a exceção
    // defensável: a consulta não alcança dado de conta nenhuma.
    expect(comContexto).toEqual(semContexto);
  });

  it('não expõe nada além do NOME da migração', async () => {
    // O mesmo SELECT do código, para provar o que ele devolve. (A regra do lint
    // vale para `src/`; aqui o client cru já é a ferramenta do arquivo.)
    const linhas = await rawDb.$queryRaw<Array<Record<string, unknown>>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL LIMIT 1
    `;

    expect(linhas.length).toBeGreaterThan(0);
    expect(Object.keys(linhas[0] ?? {})).toEqual(['migration_name']);
  });
});
