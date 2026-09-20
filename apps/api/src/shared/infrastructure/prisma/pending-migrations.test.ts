import { describe, expect, it } from 'vitest';
import { findPendingMigrations, migrationsDir, migrationsOnDisk } from './pending-migrations.js';
import type { Db } from './client.js';

/**
 * A decisão de MIGRAR NO BOOT precisa distinguir três estados do banco.
 *
 * Só um deles autoriza aplicar migração sozinho:
 *
 *   em dia          não faz nada
 *   nunca migrado   aplica — é o volume recriado, o caso que o boot existe para resolver
 *   inacessível     PROPAGA, e não tenta migrar contra um banco que não responde
 *
 * O terceiro é o que este arquivo protege. Engolir o erro transformaria
 * "credencial errada" em "vou migrar do zero", trocando um erro claro de
 * conexão por um erro de migração que não explica nada.
 */
function dbQueRetorna(nomes: string[]): Db {
  return {
    $queryRaw: () => Promise.resolve(nomes.map((migration_name) => ({ migration_name }))),
  } as unknown as Db;
}

function dbQueFalha(mensagem: string): Db {
  return {
    $queryRaw: () => Promise.reject(new Error(mensagem)),
  } as unknown as Db;
}

describe('migrações pendentes', () => {
  it('lê as pastas do disco em ordem — é a ordem em que o deploy aplica', () => {
    const pastas = migrationsOnDisk(migrationsDir());

    expect(pastas.length).toBeGreaterThan(0);
    expect([...pastas].sort()).toEqual(pastas);
  });

  it('banco EM DIA não tem pendência', async () => {
    const todas = migrationsOnDisk(migrationsDir());

    const resultado = await findPendingMigrations(dbQueRetorna(todas));

    expect(resultado).toEqual({ pending: [], virgin: false });
  });

  it('migração NOVA num banco com schema é detectada', async () => {
    const todas = migrationsOnDisk(migrationsDir());
    // O banco conhece todas menos a última: é exatamente o estado depois de um
    // `git pull` que trouxe migração.
    const semAUltima = todas.slice(0, -1);

    const resultado = await findPendingMigrations(dbQueRetorna(semAUltima));

    // A checagem anterior olhava para uma tabela da PRIMEIRA migração e dizia
    // "tudo certo" aqui — a API subia e quebrava depois, longe da causa.
    expect(resultado.pending).toEqual([todas.at(-1)]);
    expect(resultado.virgin).toBe(false);
  });

  it('SEM a tabela de controle, tudo é pendente e o banco é novo', async () => {
    const resultado = await findPendingMigrations(
      dbQueFalha("Table 'myaihub._prisma_migrations' doesn't exist"),
    );

    expect(resultado.virgin).toBe(true);
    expect(resultado.pending).toEqual(migrationsOnDisk(migrationsDir()));
  });

  it('reconhece a ausência pelo CÓDIGO do MySQL também', async () => {
    const resultado = await findPendingMigrations(
      dbQueFalha('Raw query failed. Code: `1146`. Message: `unknown table`'),
    );

    expect(resultado.virgin).toBe(true);
  });

  it('banco INACESSÍVEL propaga — não vira "vou migrar do zero"', async () => {
    // Sem isto, uma credencial errada faria o boot tentar migrar contra um
    // banco que ele nem alcança, e o usuário leria um erro de migração no lugar
    // do erro de conexão que explica o problema.
    await expect(findPendingMigrations(dbQueFalha('ECONNREFUSED 127.0.0.1:3306'))).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it('credencial inválida também propaga', async () => {
    await expect(
      findPendingMigrations(dbQueFalha("Access denied for user 'myaihub'@'localhost'")),
    ).rejects.toThrow(/Access denied/);
  });
});
