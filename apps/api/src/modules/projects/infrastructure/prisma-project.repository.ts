import {
  canonicalProjectProfileV2Schema,
  parseCanonical,
  PROJECT_PROFILE_SCHEMAS,
  type CanonicalProjectProfile,
} from '@myaihub/shared';
import type { Prisma } from '@prisma/client';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { ConcurrencyError, ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Db, DbTx } from '../../../shared/infrastructure/prisma/client.js';
import {
  isUniqueViolationOn,
  withWriteConflictRetry,
} from '../../../shared/infrastructure/prisma/transaction.js';
import type {
  ConfigurationChangeInput,
  CreateProjectInput,
  ProjectProfileVersionRecord,
  ProjectRecord,
  ProjectRepository,
  ProjectWithProfile,
  UpdateProfileInput,
} from '../domain/repositories.js';

const MAX_SLUG_ATTEMPTS = 20;

type PrismaProject = Prisma.ProjectGetPayload<Record<string, never>>;
type PrismaVersion = Prisma.ProjectProfileVersionGetPayload<Record<string, never>>;

function toProject(row: PrismaProject): ProjectRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    currentProfileVersionId: row.currentProfileVersionId,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
  };
}

function toVersion(row: PrismaVersion): ProjectProfileVersionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    // Migra na leitura: documento antigo continua interpretável sem reescrever
    // o histórico (§5.3).
    canonicalConfig: parseCanonical(row.canonicalConfig, PROJECT_PROFILE_SCHEMAS),
    humanSummary: Array.isArray(row.humanSummary) ? (row.humanSummary as string[]) : [],
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditWriter,
  ) {}

  private async writeChange(
    tx: DbTx,
    accountId: string,
    change: ConfigurationChangeInput,
  ): Promise<void> {
    await tx.configurationChange.create({
      data: {
        id: change.id,
        accountId,
        entityType: change.entityType,
        entityId: change.entityId,
        fromVersionId: change.fromVersionId,
        fromVersion: change.fromVersion,
        toVersionId: change.toVersionId,
        toVersion: change.toVersion,
        source: change.source,
        actorUserId: change.actorUserId,
        hubOperationId: change.hubOperationId,
        hubMessageId: change.hubMessageId,
        interpretedIntent: change.interpretedIntent,
        mutations: change.mutations as unknown as Prisma.InputJsonValue,
        rationale: change.rationale,
      },
    });
  }

  async create(context: TenantContext, input: CreateProjectInput): Promise<ProjectWithProfile> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug =
        attempt === 0 ? input.project.slugBase : `${input.project.slugBase}-${attempt + 1}`;

      try {
        return await withWriteConflictRetry(() => this.insert(context, input, slug));
      } catch (error) {
        // Slug é único POR CONTA: a colisão só acontece dentro do mesmo tenant.
        if (isUniqueViolationOn(error, 'slug')) continue;
        throw error;
      }
    }

    throw new ConflictError('CONFLICT', 'Não foi possível gerar um identificador para o projeto.');
  }

  private async insert(
    context: TenantContext,
    input: CreateProjectInput,
    slug: string,
  ): Promise<ProjectWithProfile> {
    return this.db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          id: input.project.id,
          accountId: context.accountId,
          name: input.project.name,
          slug,
          createdBy: input.project.createdBy,
          lockVersion: 1,
          currentProfileVersionId: input.profileVersion.id,
        },
      });

      const version = await tx.projectProfileVersion.create({
        data: {
          id: input.profileVersion.id,
          accountId: context.accountId,
          projectId: project.id,
          versionNumber: 1,
          canonicalConfig: input.profileVersion.canonicalConfig as unknown as Prisma.InputJsonValue,
          canonicalSchemaVersion: input.profileVersion.canonicalConfig.canonicalSchemaVersion,
          humanSummary: input.profileVersion.humanSummary as unknown as Prisma.InputJsonValue,
          source: input.profileVersion.source,
          reason: input.profileVersion.reason,
          previousVersionId: null,
        },
      });

      await tx.projectCapability.create({
        data: {
          id: input.capability.id,
          accountId: context.accountId,
          projectId: project.id,
          type: input.capability.type,
        },
      });

      // Versão, ponteiro, mudança e auditoria na MESMA transação (§4.1, §69).
      await this.writeChange(tx, context.accountId, {
        ...input.change,
        entityId: project.id,
        fromVersionId: null,
        fromVersion: null,
        toVersionId: version.id,
        toVersion: 1,
      });

      await this.audit.write({ ...input.audit, entityId: project.id }, tx);

      return { project: toProject(project), profile: toVersion(version) };
    });
  }

  async updateProfile(
    context: TenantContext,
    input: UpdateProfileInput,
  ): Promise<ProjectWithProfile> {
    return withWriteConflictRetry(() =>
      this.db.$transaction(async (tx) => {
        const current = await tx.project.findFirst({
          where: { id: input.projectId, accountId: context.accountId },
        });
        if (!current) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

        const versionNumber =
          (await tx.projectProfileVersion.count({
            where: { projectId: input.projectId, accountId: context.accountId },
          })) + 1;

        const version = await tx.projectProfileVersion.create({
          data: {
            id: input.profileVersion.id,
            accountId: context.accountId,
            projectId: input.projectId,
            versionNumber,
            canonicalConfig: input.profileVersion
              .canonicalConfig as unknown as Prisma.InputJsonValue,
            canonicalSchemaVersion: input.profileVersion.canonicalConfig.canonicalSchemaVersion,
            humanSummary: input.profileVersion.humanSummary as unknown as Prisma.InputJsonValue,
            source: input.profileVersion.source,
            reason: input.profileVersion.reason,
            previousVersionId: current.currentProfileVersionId,
          },
        });

        // Lock otimista: o UPDATE só acerta se ninguém mudou no meio do caminho.
        // Sem isto, o usuário B sobrescreveria o usuário A em silêncio (§70).
        const updated = await tx.project.updateMany({
          where: {
            id: input.projectId,
            accountId: context.accountId,
            lockVersion: input.expectedLockVersion,
          },
          data: {
            currentProfileVersionId: version.id,
            lockVersion: { increment: 1 },
            name: input.profileVersion.canonicalConfig.name,
          },
        });

        if (updated.count === 0) throw new ConcurrencyError('O projeto');

        await this.writeChange(tx, context.accountId, {
          ...input.change,
          entityId: input.projectId,
          toVersionId: version.id,
          toVersion: versionNumber,
        });

        await this.audit.write(input.audit, tx);

        const project = await tx.project.findFirstOrThrow({
          where: { id: input.projectId, accountId: context.accountId },
        });

        return { project: toProject(project), profile: toVersion(version) };
      }),
    );
  }

  async findById(context: TenantContext, id: string): Promise<ProjectWithProfile | null> {
    // findFirst com accountId — nunca findUnique por id, que é o padrão que abre IDOR.
    const project = await this.db.project.findFirst({
      where: { id, accountId: context.accountId },
    });
    if (!project) return null;

    const version = project.currentProfileVersionId
      ? await this.db.projectProfileVersion.findFirst({
          where: { id: project.currentProfileVersionId, accountId: context.accountId },
        })
      : null;

    return { project: toProject(project), profile: version ? toVersion(version) : null };
  }

  async list(
    context: TenantContext,
    limit: number,
    cursor: string | null,
  ): Promise<ProjectRecord[]> {
    const rows = await this.db.project.findMany({
      where: {
        accountId: context.accountId,
        status: 'ACTIVE',
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map(toProject);
  }

  async countForAccount(context: TenantContext): Promise<number> {
    return this.db.project.count({ where: { accountId: context.accountId, status: 'ACTIVE' } });
  }

  async listVersions(
    context: TenantContext,
    projectId: string,
    limit: number,
  ): Promise<ProjectProfileVersionRecord[]> {
    const rows = await this.db.projectProfileVersion.findMany({
      where: { projectId, accountId: context.accountId },
      orderBy: { versionNumber: 'desc' },
      take: limit,
    });

    return rows.map(toVersion);
  }
}

export { canonicalProjectProfileV2Schema, type CanonicalProjectProfile };
