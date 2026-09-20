import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type {
  CreateKnowledgeSourceInput,
  KnowledgeRepository,
  KnowledgeRevisionRecord,
  KnowledgeSourceRecord,
  SaveRevisionInput,
  SnapshotEntry,
} from '../domain/knowledge-repositories.js';

type SourceRow = Prisma.ProjectKnowledgeSourceGetPayload<{
  include: {
    revisions: {
      select: { id: true; revisionNumber: true; contentLength: true; extractedAt: true };
    };
  };
}>;

function toSource(row: SourceRow): KnowledgeSourceRecord {
  const current = row.revisions.find((revision) => revision.id === row.currentRevisionId);

  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    uri: row.uri,
    currentRevisionId: row.currentRevisionId,
    revisionNumber: current?.revisionNumber ?? null,
    contentLength: current?.contentLength ?? 0,
    lastError: row.lastError,
    extractedAt: current?.extractedAt ?? null,
    createdAt: row.createdAt,
  };
}

const CURRENT_REVISION_SELECT = {
  revisions: {
    select: { id: true, revisionNumber: true, contentLength: true, extractedAt: true },
  },
} as const;

export class PrismaKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly db: Db) {}

  async createSource(
    context: TenantContext,
    input: CreateKnowledgeSourceInput,
  ): Promise<KnowledgeSourceRecord> {
    const row = await this.db.projectKnowledgeSource.create({
      data: {
        id: input.id,
        accountId: context.accountId,
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        uri: input.uri,
        createdBy: input.createdBy,
      },
      include: CURRENT_REVISION_SELECT,
    });

    return toSource(row);
  }

  /**
   * Revisão nova, e o ponteiro junto.
   *
   * Conteúdo IDÊNTICO não cria revisão: reindexar uma página que não mudou
   * geraria um id novo descrevendo exatamente o mesmo texto, e cada publicação
   * seguinte congelaria uma revisão diferente sem diferença nenhuma — o
   * histórico deixaria de dizer quando o conhecimento de fato mudou.
   */
  async saveRevision(
    context: TenantContext,
    input: SaveRevisionInput,
  ): Promise<KnowledgeRevisionRecord | null> {
    return this.db.$transaction(async (tx) => {
      const source = await tx.projectKnowledgeSource.findFirst({
        where: { id: input.sourceId, accountId: context.accountId },
        select: { id: true, currentRevisionId: true },
      });
      if (!source) throw new NotFoundError('NOT_FOUND', 'Fonte não encontrada.');

      const current = source.currentRevisionId
        ? await tx.knowledgeRevision.findFirst({
            where: { id: source.currentRevisionId, accountId: context.accountId },
            select: { contentHash: true, revisionNumber: true },
          })
        : null;

      if (current?.contentHash === input.revision.contentHash) {
        // Sem revisão nova, mas a fonte volta a READY: uma indexação que falhou
        // e depois encontrou o mesmo conteúdo é sucesso, não falha antiga.
        // `updateMany`, não `update`: numa tabela tenant-scoped um `where` sem
        // accountId é a forma exata do IDOR, e o tenantGuard barra — com razão.
        await tx.projectKnowledgeSource.updateMany({
          where: { id: input.sourceId, accountId: context.accountId },
          data: { status: 'READY', lastError: null },
        });
        return null;
      }

      const created = await tx.knowledgeRevision.create({
        data: {
          id: input.revision.id,
          accountId: context.accountId,
          sourceId: input.sourceId,
          revisionNumber: (current?.revisionNumber ?? 0) + 1,
          contentHash: input.revision.contentHash,
          extractedContent: input.revision.extractedContent,
          contentLength: input.revision.extractedContent.length,
        },
      });

      await tx.projectKnowledgeSource.updateMany({
        where: { id: input.sourceId, accountId: context.accountId },
        data: { currentRevisionId: created.id, status: 'READY', lastError: null },
      });

      return {
        id: created.id,
        sourceId: created.sourceId,
        revisionNumber: created.revisionNumber,
        contentHash: created.contentHash,
        extractedContent: created.extractedContent,
        contentLength: created.contentLength,
        extractedAt: created.extractedAt,
      };
    });
  }

  async markFailed(context: TenantContext, sourceId: string, error: string): Promise<void> {
    await this.db.projectKnowledgeSource.updateMany({
      where: { id: sourceId, accountId: context.accountId },
      data: { status: 'FAILED', lastError: error.slice(0, 300) },
    });
  }

  async listSources(context: TenantContext, projectId: string): Promise<KnowledgeSourceRecord[]> {
    const rows = await this.db.projectKnowledgeSource.findMany({
      where: { projectId, accountId: context.accountId },
      orderBy: { createdAt: 'desc' },
      include: CURRENT_REVISION_SELECT,
    });
    return rows.map(toSource);
  }

  async listAccountSources(
    context: TenantContext,
    limit: number,
  ): Promise<KnowledgeSourceRecord[]> {
    const rows = await this.db.projectKnowledgeSource.findMany({
      where: { accountId: context.accountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: CURRENT_REVISION_SELECT,
    });
    return rows.map(toSource);
  }

  async findSource(context: TenantContext, id: string): Promise<KnowledgeSourceRecord | null> {
    const row = await this.db.projectKnowledgeSource.findFirst({
      where: { id, accountId: context.accountId },
      include: CURRENT_REVISION_SELECT,
    });
    return row ? toSource(row) : null;
  }

  async readRevision(context: TenantContext, id: string): Promise<KnowledgeRevisionRecord | null> {
    const row = await this.db.knowledgeRevision.findFirst({
      where: { id, accountId: context.accountId },
    });
    if (!row) return null;

    return {
      id: row.id,
      sourceId: row.sourceId,
      revisionNumber: row.revisionNumber,
      contentHash: row.contentHash,
      extractedContent: row.extractedContent,
      contentLength: row.contentLength,
      extractedAt: row.extractedAt,
    };
  }

  async deleteSource(context: TenantContext, id: string): Promise<void> {
    // O `Restrict` do KnowledgeSnapshotItem manda aqui: fonte que já foi
    // congelada num deployment não pode sumir, senão a publicação passaria a
    // apontar para nada.
    //
    // A checagem é ANTES, e não a exceção do banco depois: um P2003 cru sobe
    // como 500 e diz ao usuário que o sistema quebrou, quando na verdade ele
    // pediu algo que a publicação imutável não permite. São coisas
    // diferentes, e a mensagem precisa dizer qual é.
    const congelada = await this.db.knowledgeSnapshotItem.findFirst({
      where: { sourceId: id, accountId: context.accountId },
      select: { snapshotId: true },
    });

    if (congelada) {
      throw new ConflictError(
        'CONFLICT',
        'Esta fonte já está no ar numa campanha publicada e não pode ser removida. ' +
          'Republique a campanha sem ela, ou despublique antes.',
      );
    }

    await this.db.projectKnowledgeSource.deleteMany({
      where: { id, accountId: context.accountId },
    });
  }

  async createSnapshot(
    context: TenantContext,
    input: { id: string; projectId: string; itemIds: string[]; newId: () => string },
  ): Promise<string | null> {
    return this.db.$transaction(async (tx) => {
      const sources = await tx.projectKnowledgeSource.findMany({
        where: {
          projectId: input.projectId,
          accountId: context.accountId,
          status: 'READY',
          currentRevisionId: { not: null },
          ...(input.itemIds.length > 0 ? { id: { in: input.itemIds } } : {}),
        },
        select: { id: true, currentRevisionId: true },
      });

      if (sources.length === 0) return null;

      const snapshot = await tx.knowledgeSnapshot.create({
        data: {
          id: input.id,
          accountId: context.accountId,
          projectId: input.projectId,
          itemCount: sources.length,
        },
      });

      await tx.knowledgeSnapshotItem.createMany({
        data: sources.map((source) => ({
          id: input.newId(),
          accountId: context.accountId,
          snapshotId: snapshot.id,
          sourceId: source.id,
          revisionId: source.currentRevisionId as string,
        })),
      });

      return snapshot.id;
    });
  }

  async readSnapshot(context: TenantContext, snapshotId: string): Promise<SnapshotEntry[]> {
    const items = await this.db.knowledgeSnapshotItem.findMany({
      where: { snapshotId, accountId: context.accountId },
      include: {
        source: { select: { title: true, uri: true } },
        revision: { select: { extractedContent: true } },
      },
    });

    return items.map((item) => ({
      sourceId: item.sourceId,
      revisionId: item.revisionId,
      title: item.source.title,
      uri: item.source.uri,
      extractedContent: item.revision.extractedContent,
    }));
  }
}
