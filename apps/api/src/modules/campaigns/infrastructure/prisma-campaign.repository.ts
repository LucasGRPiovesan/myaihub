import { CAMPAIGN_SCHEMAS, parseCanonical } from '@myaihub/shared';
import type { Prisma } from '@prisma/client';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { ConcurrencyError, ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Db, DbTx } from '../../../shared/infrastructure/prisma/client.js';
import {
  isUniqueViolationOn,
  withWriteConflictRetry,
} from '../../../shared/infrastructure/prisma/transaction.js';
import type { DeploymentManifest } from '../domain/manifest.js';
import type { CampaignMutation } from '../domain/mutations.js';
import type {
  BindAgentInput,
  CampaignRecord,
  CampaignRepository,
  CampaignVersionRecord,
  CampaignWithVersion,
  CreateCampaignInput,
  DeploymentRecord,
  PublishCampaignInput,
  UpdateCampaignInput,
} from '../domain/repositories.js';

const MAX_SLUG_ATTEMPTS = 20;

type PrismaCampaign = Prisma.CampaignGetPayload<Record<string, never>>;
type PrismaVersion = Prisma.CampaignVersionGetPayload<Record<string, never>>;
type PrismaDeployment = Prisma.CampaignPublicDeploymentGetPayload<Record<string, never>>;

function toCampaign(row: PrismaCampaign, heroImageAssetId: string | null = null): CampaignRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    projectId: row.projectId,
    agentId: row.agentId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    publicId: row.publicId,
    currentVersionId: row.currentVersionId,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
    heroImageAssetId,
  };
}

function toVersion(row: PrismaVersion): CampaignVersionRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    versionNumber: row.versionNumber,
    // Migra na leitura; o documento gravado não é reescrito (§5.3).
    canonicalConfig: parseCanonical(row.canonicalConfig, CAMPAIGN_SCHEMAS),
    humanSummary: Array.isArray(row.humanSummary) ? (row.humanSummary as string[]) : [],
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function toDeployment(row: PrismaDeployment): DeploymentRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    deploymentNumber: row.deploymentNumber,
    status: row.status,
    campaignVersionId: row.campaignVersionId,
    manifest: row.manifest as unknown as DeploymentManifest,
    manifestHash: row.manifestHash,
    publishedAt: row.publishedAt,
    supersededAt: row.supersededAt,
  };
}

export class PrismaCampaignRepository implements CampaignRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditWriter,
  ) {}

  private async writeChange(
    tx: DbTx,
    accountId: string,
    change: {
      id: string;
      entityId: string;
      fromVersionId: string | null;
      fromVersion: number | null;
      toVersionId: string;
      toVersion: number;
      source: 'USER' | 'MYAIHUB' | 'SYSTEM';
      actorUserId: string | null;
      hubOperationId: string | null;
      hubMessageId: string | null;
      interpretedIntent: string;
      mutations: CampaignMutation[];
      rationale: string;
    },
  ): Promise<void> {
    await tx.configurationChange.create({
      data: {
        id: change.id,
        accountId,
        entityType: 'CAMPAIGN',
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

  async create(context: TenantContext, input: CreateCampaignInput): Promise<CampaignWithVersion> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug =
        attempt === 0 ? input.campaign.slugBase : `${input.campaign.slugBase}-${attempt + 1}`;

      try {
        return await withWriteConflictRetry(() => this.insert(context, input, slug));
      } catch (error) {
        if (isUniqueViolationOn(error, 'slug')) continue;
        throw error;
      }
    }

    throw new ConflictError('CONFLICT', 'Não foi possível gerar um identificador para a campanha.');
  }

  private async insert(
    context: TenantContext,
    input: CreateCampaignInput,
    slug: string,
  ): Promise<CampaignWithVersion> {
    return this.db.$transaction(async (tx) => {
      // O projeto precisa ser DESTA conta: sem esta checagem, um projectId
      // vindo da rota bastaria para criar campanha dentro do projeto alheio.
      const project = await tx.project.findFirst({
        where: { id: input.campaign.projectId, accountId: context.accountId },
        select: { id: true },
      });
      if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

      if (input.campaign.agentId) {
        const agent = await tx.agent.findFirst({
          where: { id: input.campaign.agentId, accountId: context.accountId },
          select: { id: true },
        });
        if (!agent) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');
      }

      const campaign = await tx.campaign.create({
        data: {
          id: input.campaign.id,
          accountId: context.accountId,
          projectId: input.campaign.projectId,
          agentId: input.campaign.agentId,
          name: input.campaign.name,
          slug,
          createdBy: input.campaign.createdBy,
          lockVersion: 1,
          currentVersionId: input.version.id,
        },
      });

      const version = await tx.campaignVersion.create({
        data: {
          id: input.version.id,
          accountId: context.accountId,
          campaignId: campaign.id,
          versionNumber: 1,
          canonicalConfig: input.version.canonicalConfig as unknown as Prisma.InputJsonValue,
          canonicalSchemaVersion: input.version.canonicalConfig.canonicalSchemaVersion,
          humanSummary: input.version.humanSummary as unknown as Prisma.InputJsonValue,
          source: input.version.source,
          reason: input.version.reason,
          previousVersionId: null,
        },
      });

      await this.writeChange(tx, context.accountId, {
        ...input.change,
        entityId: campaign.id,
        fromVersionId: null,
        fromVersion: null,
        toVersionId: version.id,
        toVersion: 1,
      });

      await this.audit.write({ ...input.audit, entityId: campaign.id }, tx);

      return { campaign: toCampaign(campaign), version: toVersion(version) };
    });
  }

  async updateStrategy(
    context: TenantContext,
    input: UpdateCampaignInput,
  ): Promise<CampaignWithVersion> {
    return withWriteConflictRetry(() =>
      this.db.$transaction(async (tx) => {
        const current = await tx.campaign.findFirst({
          where: { id: input.campaignId, accountId: context.accountId },
        });
        if (!current) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

        const versionNumber =
          (await tx.campaignVersion.count({
            where: { campaignId: input.campaignId, accountId: context.accountId },
          })) + 1;

        const version = await tx.campaignVersion.create({
          data: {
            id: input.version.id,
            accountId: context.accountId,
            campaignId: input.campaignId,
            versionNumber,
            canonicalConfig: input.version.canonicalConfig as unknown as Prisma.InputJsonValue,
            canonicalSchemaVersion: input.version.canonicalConfig.canonicalSchemaVersion,
            humanSummary: input.version.humanSummary as unknown as Prisma.InputJsonValue,
            source: input.version.source,
            reason: input.version.reason,
            previousVersionId: current.currentVersionId,
          },
        });

        const updated = await tx.campaign.updateMany({
          where: {
            id: input.campaignId,
            accountId: context.accountId,
            lockVersion: input.expectedLockVersion,
          },
          data: {
            currentVersionId: version.id,
            lockVersion: { increment: 1 },
            name: input.version.canonicalConfig.identity.name,
          },
        });

        if (updated.count === 0) throw new ConcurrencyError('A campanha');

        await this.writeChange(tx, context.accountId, {
          ...input.change,
          entityId: input.campaignId,
          toVersionId: version.id,
          toVersion: versionNumber,
        });

        await this.audit.write(input.audit, tx);

        const campaign = await tx.campaign.findFirstOrThrow({
          where: { id: input.campaignId, accountId: context.accountId },
        });

        return { campaign: toCampaign(campaign), version: toVersion(version) };
      }),
    );
  }

  async bindAgent(context: TenantContext, input: BindAgentInput): Promise<CampaignRecord> {
    return withWriteConflictRetry(() =>
      this.db.$transaction(async (tx) => {
        if (input.agentId) {
          const agent = await tx.agent.findFirst({
            where: { id: input.agentId, accountId: context.accountId },
            select: { id: true },
          });
          if (!agent) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');
        }

        const updated = await tx.campaign.updateMany({
          where: {
            id: input.campaignId,
            accountId: context.accountId,
            lockVersion: input.expectedLockVersion,
          },
          data: { agentId: input.agentId, lockVersion: { increment: 1 } },
        });

        if (updated.count === 0) {
          const exists = await tx.campaign.findFirst({
            where: { id: input.campaignId, accountId: context.accountId },
            select: { id: true },
          });
          if (!exists) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
          throw new ConcurrencyError('A campanha');
        }

        await this.audit.write(input.audit, tx);

        const campaign = await tx.campaign.findFirstOrThrow({
          where: { id: input.campaignId, accountId: context.accountId },
        });

        const version = campaign.currentVersionId
          ? await tx.campaignVersion.findFirst({
              where: { id: campaign.currentVersionId, accountId: context.accountId },
              select: { canonicalConfig: true },
            })
          : null;

        return toCampaign(
          campaign,
          version
            ? parseCanonical(version.canonicalConfig, CAMPAIGN_SCHEMAS).heroImageAssetId
            : null,
        );
      }),
    );
  }

  async findById(context: TenantContext, id: string): Promise<CampaignWithVersion | null> {
    const campaign = await this.db.campaign.findFirst({
      where: { id, accountId: context.accountId },
    });
    if (!campaign) return null;

    const version = campaign.currentVersionId
      ? await this.db.campaignVersion.findFirst({
          where: { id: campaign.currentVersionId, accountId: context.accountId },
        })
      : null;

    const versionRecord = version ? toVersion(version) : null;
    return {
      campaign: toCampaign(campaign, versionRecord?.canonicalConfig.heroImageAssetId ?? null),
      version: versionRecord,
    };
  }

  async list(
    context: TenantContext,
    filter: { projectId?: string; agentId?: string },
    limit: number,
    cursor: string | null,
  ): Promise<CampaignRecord[]> {
    const rows = await this.db.campaign.findMany({
      where: {
        accountId: context.accountId,
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.agentId ? { agentId: filter.agentId } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    // Carrossel/listagem precisa da imagem-herói, que vive no canônico da
    // versão CORRENTE — um lote só, não uma consulta por campanha.
    const versionIds = rows.map((row) => row.currentVersionId).filter((id) => id !== null);
    const versions =
      versionIds.length > 0
        ? await this.db.campaignVersion.findMany({
            where: { id: { in: versionIds }, accountId: context.accountId },
            select: { id: true, canonicalConfig: true },
          })
        : [];
    const heroByVersionId = new Map(
      versions.map((version) => [
        version.id,
        parseCanonical(version.canonicalConfig, CAMPAIGN_SCHEMAS).heroImageAssetId,
      ]),
    );

    return rows.map((row) =>
      toCampaign(
        row,
        row.currentVersionId ? (heroByVersionId.get(row.currentVersionId) ?? null) : null,
      ),
    );
  }

  async listVersions(
    context: TenantContext,
    campaignId: string,
    limit: number,
  ): Promise<CampaignVersionRecord[]> {
    const rows = await this.db.campaignVersion.findMany({
      where: { campaignId, accountId: context.accountId },
      orderBy: { versionNumber: 'desc' },
      take: limit,
    });

    return rows.map(toVersion);
  }

  async publish(context: TenantContext, input: PublishCampaignInput): Promise<DeploymentRecord> {
    return withWriteConflictRetry(() =>
      this.db.$transaction(async (tx) => {
        const current = await tx.campaign.findFirst({
          where: { id: input.campaignId, accountId: context.accountId },
        });
        if (!current) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

        const deploymentNumber =
          (await tx.campaignPublicDeployment.count({
            where: { campaignId: input.campaignId, accountId: context.accountId },
          })) + 1;

        // Republicar não apaga o anterior: marca SUPERSEDED. Sessões nascidas
        // sob ele continuam apontando para o deployment com que nasceram (§4.3).
        await tx.campaignPublicDeployment.updateMany({
          where: {
            campaignId: input.campaignId,
            accountId: context.accountId,
            status: 'ACTIVE',
          },
          data: { status: 'SUPERSEDED', supersededAt: new Date() },
        });

        const deployment = await tx.campaignPublicDeployment.create({
          data: {
            id: input.deployment.id,
            accountId: context.accountId,
            campaignId: input.campaignId,
            deploymentNumber,
            status: 'ACTIVE',
            campaignVersionId: input.deployment.campaignVersionId,
            manifest: input.deployment.manifest as unknown as Prisma.InputJsonValue,
            manifestHash: input.deployment.manifestHash,
            publishedBy: input.deployment.publishedBy,
          },
        });

        const updated = await tx.campaign.updateMany({
          where: {
            id: input.campaignId,
            accountId: context.accountId,
            lockVersion: input.expectedLockVersion,
          },
          data: {
            status: 'PUBLISHED',
            lockVersion: { increment: 1 },
            // `publicId` só na PRIMEIRA publicação: a URL do anúncio não pode
            // mudar porque alguém republicou (§4.3).
            ...(current.publicId ? {} : { publicId: input.publicIdIfFirst }),
          },
        });

        if (updated.count === 0) throw new ConcurrencyError('A campanha');

        await this.audit.write(input.audit, tx);

        return toDeployment(deployment);
      }),
    );
  }

  async listDeployments(
    context: TenantContext,
    campaignId: string,
    limit: number,
  ): Promise<DeploymentRecord[]> {
    const rows = await this.db.campaignPublicDeployment.findMany({
      where: { campaignId, accountId: context.accountId },
      orderBy: { deploymentNumber: 'desc' },
      take: limit,
    });

    return rows.map(toDeployment);
  }

  async findActiveDeployment(
    context: TenantContext,
    campaignId: string,
  ): Promise<DeploymentRecord | null> {
    const row = await this.db.campaignPublicDeployment.findFirst({
      where: { campaignId, accountId: context.accountId, status: 'ACTIVE' },
      orderBy: { deploymentNumber: 'desc' },
    });

    return row ? toDeployment(row) : null;
  }
}
