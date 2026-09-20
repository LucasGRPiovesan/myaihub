import type { ZodType } from 'zod';

/**
 * Migração de schemas canônicos (§5.3).
 *
 * Documento antigo continua interpretável: `parseCanonical` aplica as migrações
 * em cadeia NA LEITURA (v1→v2→v3) e devolve a forma atual. O documento
 * persistido não é reescrito — a versão gravada é a que foi criada, e reescrever
 * histórico apagaria a rastreabilidade que o versionamento existe para dar.
 *
 * A reescrita acontece naturalmente quando uma versão nova é criada.
 */

export interface CanonicalMigration {
  from: number;
  to: number;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

export interface CanonicalSchemaSet<T> {
  /** Versão corrente do documento. */
  latest: number;
  /** Schema Zod da versão corrente. */
  schema: ZodType<T>;
  /** Migrações ordenadas. Precisam formar uma cadeia contígua até `latest`. */
  migrations: CanonicalMigration[];
}

export class CanonicalMigrationError extends Error {}

function readVersion(document: Record<string, unknown>): number {
  const version = document['canonicalSchemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new CanonicalMigrationError(
      'Documento canônico sem `canonicalSchemaVersion` válida. Impossível saber como interpretá-lo.',
    );
  }
  return version;
}

/**
 * Lê um documento canônico de qualquer versão suportada e devolve a atual.
 */
export function parseCanonical<T>(raw: unknown, schemas: CanonicalSchemaSet<T>): T {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CanonicalMigrationError('Documento canônico precisa ser um objeto.');
  }

  let document = { ...(raw as Record<string, unknown>) };
  let version = readVersion(document);

  if (version > schemas.latest) {
    // Downgrade não é possível: este código não conhece o formato futuro.
    // Acontece de verdade num rollback de deploy com dados já migrados.
    throw new CanonicalMigrationError(
      `Documento na versão ${version}, mas esta build entende no máximo a ${schemas.latest}. ` +
        'Provavelmente o banco foi escrito por uma versão mais nova da aplicação.',
    );
  }

  while (version < schemas.latest) {
    const step = schemas.migrations.find((migration) => migration.from === version);
    if (!step) {
      throw new CanonicalMigrationError(
        `Falta migração canônica da versão ${version} para ${version + 1}. Cadeia interrompida.`,
      );
    }

    document = step.migrate(document);
    document['canonicalSchemaVersion'] = step.to;
    version = step.to;
  }

  const parsed = schemas.schema.safeParse(document);
  if (!parsed.success) {
    throw new CanonicalMigrationError(
      `Documento canônico inválido após migração: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  return parsed.data;
}

/**
 * Verifica que as migrações formam uma cadeia contígua até `latest`.
 * Roda em teste: uma cadeia quebrada só apareceria ao ler um documento antigo,
 * que é o pior momento para descobrir.
 */
export function assertMigrationChain(schemas: CanonicalSchemaSet<unknown>): void {
  for (let version = 1; version < schemas.latest; version += 1) {
    const step = schemas.migrations.find((migration) => migration.from === version);
    if (!step) {
      throw new CanonicalMigrationError(
        `Cadeia de migração quebrada em ${version} → ${version + 1}.`,
      );
    }
    if (step.to !== version + 1) {
      throw new CanonicalMigrationError(
        `Migração de ${version} salta para ${step.to}. Passos precisam ser de um em um.`,
      );
    }
  }
}
