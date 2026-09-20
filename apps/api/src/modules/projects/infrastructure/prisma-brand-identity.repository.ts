import { BRAND_IDENTITY_SCHEMAS, parseCanonical } from '@myaihub/shared';
import type { Prisma } from '@prisma/client';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { ConcurrencyError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type {
  BrandIdentityRepository,
  BrandIdentityVersionRecord,
  UpdateBrandIdentityInput,
} from '../domain/brand-repositories.js';

type PrismaBrandVersion = Prisma.ProjectBrandIdentityVersionGetPayload<Record<string, never>>;

function toVersion(row: PrismaBrandVersion): BrandIdentityVersionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    // Migra na leitura; o documento gravado não é reescrito (§5.3).
    canonicalConfig: parseCanonical(row.canonicalConfig, BRAND_IDENTITY_SCHEMAS),
    humanSummary: Array.isArray(row.humanSummary) ? (row.humanSummary as string[]) : [],
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export class PrismaBrandIdentityRepository implements BrandIdentityRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * Versão + ponteiro + change + auditoria na MESMA transação (invariante 5).
   *
   * Não é zelo: gravar a versão e mover o ponteiro em idas separadas produz a
   * janela em que o projeto aponta para uma identidade que não existe — e o
   * chat público, que é quem lê o ponteiro, é exatamente quem estaria dentro
   * dessa janela.
   */
  async update(
    context: TenantContext,
    input: UpdateBrandIdentityInput,
  ): Promise<BrandIdentityVersionRecord> {
    return this.db.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, accountId: context.accountId },
        select: { id: true, currentBrandIdentityVersionId: true },
      });
      if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

      const previous = project.currentBrandIdentityVersionId
        ? await tx.projectBrandIdentityVersion.findFirst({
            where: { id: project.currentBrandIdentityVersionId, accountId: context.accountId },
            select: { id: true, versionNumber: true },
          })
        : null;

      const versionNumber = (previous?.versionNumber ?? 0) + 1;

      const created = await tx.projectBrandIdentityVersion.create({
        data: {
          id: input.version.id,
          accountId: context.accountId,
          projectId: input.projectId,
          versionNumber,
          canonicalConfig: input.version.canonicalConfig as unknown as Prisma.InputJsonValue,
          canonicalSchemaVersion: input.version.canonicalConfig.canonicalSchemaVersion,
          humanSummary: input.version.humanSummary,
          source: input.version.source,
          reason: input.version.reason,
          previousVersionId: previous?.id ?? null,
          createdBy: context.userId,
        },
      });

      // `updateMany` e não `update`: numa tabela tenant-scoped, um `where`
      // sem accountId é a forma exata do IDOR — e o tenantGuard barra, com
      // razão. O lock otimista entra no MESMO where: assim o UPDATE só
      // acerta se ninguém mudou no meio do caminho, sem a janela entre ler a
      // versão e gravar (§70).
      const updated = await tx.project.updateMany({
        where: {
          id: input.projectId,
          accountId: context.accountId,
          lockVersion: input.expectedLockVersion,
        },
        data: {
          currentBrandIdentityVersionId: created.id,
          lockVersion: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new ConcurrencyError('A identidade de marca');

      await tx.configurationChange.create({
        data: {
          id: input.change.id,
          accountId: context.accountId,
          entityType: input.change.entityType,
          entityId: input.projectId,
          fromVersionId: previous?.id ?? null,
          fromVersion: previous?.versionNumber ?? null,
          toVersionId: created.id,
          toVersion: versionNumber,
          source: input.change.source,
          actorUserId: input.change.actorUserId,
          hubOperationId: input.change.hubOperationId,
          hubMessageId: input.change.hubMessageId,
          interpretedIntent: input.change.interpretedIntent,
          mutations: input.change.mutations as unknown as Prisma.InputJsonValue,
          rationale: input.change.rationale,
        },
      });

      await this.audit.write(input.audit, tx);

      return toVersion(created);
    });
  }

  async findCurrent(
    context: TenantContext,
    projectId: string,
  ): Promise<BrandIdentityVersionRecord | null> {
    const project = await this.db.project.findFirst({
      where: { id: projectId, accountId: context.accountId },
      select: { currentBrandIdentityVersionId: true },
    });
    if (!project?.currentBrandIdentityVersionId) return null;

    return this.findVersion(context, project.currentBrandIdentityVersionId);
  }

  async findVersion(
    context: TenantContext,
    id: string,
  ): Promise<BrandIdentityVersionRecord | null> {
    const row = await this.db.projectBrandIdentityVersion.findFirst({
      where: { id, accountId: context.accountId },
    });
    return row ? toVersion(row) : null;
  }

  async listVersions(
    context: TenantContext,
    projectId: string,
    limit: number,
  ): Promise<BrandIdentityVersionRecord[]> {
    const rows = await this.db.projectBrandIdentityVersion.findMany({
      where: { projectId, accountId: context.accountId },
      orderBy: { versionNumber: 'desc' },
      take: limit,
    });
    return rows.map(toVersion);
  }
}
