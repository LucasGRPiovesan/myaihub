import { Prisma } from '@prisma/client';
import type { Logger } from '../../application/ports.js';
import type { Db } from './client.js';

/**
 * Verifica no boot que o banco tem o schema aplicado.
 *
 * Sem isto a API sobe normalmente contra um banco vazio e só falha na primeira
 * query — com um 500 genérico que manda quem estiver depurando procurar no
 * lugar errado. Aconteceu de verdade: o volume do MySQL foi recriado, as
 * migrações se perderam, e o sintoma visível foi "Falha na requisição" na tela
 * de login.
 *
 * Falha rápido e com instrução, em vez de tarde e sem contexto.
 */
export class SchemaNotAppliedError extends Error {
  constructor(detail: string) {
    super(
      `O banco de dados não tem o schema do MyAIHub aplicado (${detail}).\n\n` +
        'Rode:\n' +
        '  npm run docker:up   (sobe, migra e semeia)\n\n' +
        'Se você recriou o volume do MySQL (docker compose down -v), isso é esperado: ' +
        'os dados e as migrações foram junto.\n\n' +
        'Se uma migração ficou PELA METADE, o `migrate deploy` vai continuar ' +
        'falhando até alguém resolver o registro — é o caso em que o banco tem ' +
        'as tabelas mas o histórico aponta uma migração inacabada. Em ' +
        'desenvolvimento, o caminho curto é recriar: `npm run db:reset`.',
    );
    this.name = 'SchemaNotAppliedError';
  }
}

export async function assertSchemaApplied(db: Db, logger: Logger): Promise<void> {
  try {
    // Uma consulta trivial num modelo que existe desde a primeira migração.
    // Barata e suficiente: se a tabela não existe, o Prisma erra na hora.
    await db.user.count({ where: { id: '__schema_check__' } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2021' || error.code === 'P2022')
    ) {
      throw new SchemaNotAppliedError(error.code === 'P2021' ? 'tabela ausente' : 'coluna ausente');
    }

    if (error instanceof Error && /does not exist/i.test(error.message)) {
      throw new SchemaNotAppliedError('tabela ausente');
    }

    // Banco inacessível é outro problema — deixa subir com o erro original,
    // que já é claro (ECONNREFUSED, credencial inválida...).
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'falha ao verificar o schema do banco',
    );
    throw error;
  }
}
