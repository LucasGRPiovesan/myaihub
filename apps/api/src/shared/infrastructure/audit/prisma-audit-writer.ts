import type { Prisma } from '@prisma/client';
import type { AuditEntry, AuditWriter, IdGenerator } from '../../application/ports.js';
import type { Db, DbTx } from '../prisma/client.js';

/**
 * Grava a trilha de auditoria (§64).
 *
 * Aceita um client transacional para que a auditoria participe da mesma
 * transação da mudança que a originou (§69) — auditoria órfã ou mudança sem
 * auditoria são igualmente inaceitáveis.
 */
export class PrismaAuditWriter implements AuditWriter {
  constructor(
    private readonly db: Db,
    private readonly ids: IdGenerator,
  ) {}

  async write(entry: AuditEntry, tx?: unknown): Promise<void> {
    const client = (tx as DbTx | undefined) ?? this.db;

    await client.auditLog.create({
      data: {
        id: this.ids.generate(),
        accountId: entry.accountId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        // Com exactOptionalPropertyTypes, passar `undefined` explicitamente não
        // é o mesmo que omitir a chave — e o Prisma só aceita a omissão.
        ...(entry.metadata ? { metadata: entry.metadata as Prisma.InputJsonValue } : {}),
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
      },
    });
  }
}
