import type {
  CanonicalAgent,
  CanonicalBrandIdentity,
  CanonicalCampaign,
  CanonicalProjectProfile,
} from '@myaihub/shared';
import type { AuditEntry } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { ConfigurationChangeInput } from '../../projects/domain/repositories.js';
import type { DeploymentManifest } from './manifest.js';
import type { CampaignMutation } from './mutations.js';

export type CampaignStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
export type DeploymentStatus = 'ACTIVE' | 'SUPERSEDED' | 'PAUSED';

export interface CampaignRecord {
  id: string;
  accountId: string;
  projectId: string;
  agentId: string | null;
  name: string;
  slug: string;
  status: CampaignStatus;
  publicId: string | null;
  currentVersionId: string | null;
  lockVersion: number;
  createdAt: Date;
  /** Do canônico da versão CORRENTE (invariante 4) — nunca coluna própria. */
  heroImageAssetId: string | null;
}

export interface CampaignVersionRecord {
  id: string;
  campaignId: string;
  versionNumber: number;
  canonicalConfig: CanonicalCampaign;
  humanSummary: string[];
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: Date;
}

export interface CampaignWithVersion {
  campaign: CampaignRecord;
  version: CampaignVersionRecord | null;
}

export interface DeploymentRecord {
  id: string;
  campaignId: string;
  deploymentNumber: number;
  status: DeploymentStatus;
  campaignVersionId: string;
  manifest: DeploymentManifest;
  manifestHash: string;
  publishedAt: Date;
  supersededAt: Date | null;
}

type CampaignChange = Omit<ConfigurationChangeInput, 'entityType' | 'mutations'> & {
  entityType: 'CAMPAIGN';
  mutations: CampaignMutation[];
};

interface VersionInput {
  id: string;
  canonicalConfig: CanonicalCampaign;
  humanSummary: string[];
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
}

export interface CreateCampaignInput {
  campaign: {
    id: string;
    projectId: string;
    /** Vínculo com o agente já na criação, quando o usuário escolheu um. */
    agentId: string | null;
    name: string;
    slugBase: string;
    createdBy: string;
  };
  version: VersionInput;
  change: Omit<
    CampaignChange,
    'entityId' | 'toVersionId' | 'toVersion' | 'fromVersionId' | 'fromVersion'
  >;
  audit: Omit<AuditEntry, 'entityId'>;
}

export interface UpdateCampaignInput {
  campaignId: string;
  expectedLockVersion: number;
  version: VersionInput;
  change: Omit<CampaignChange, 'entityId' | 'toVersionId' | 'toVersion'>;
  audit: AuditEntry;
}

export interface BindAgentInput {
  campaignId: string;
  expectedLockVersion: number;
  /** `null` desvincula. */
  agentId: string | null;
  audit: AuditEntry;
}

export interface PublishCampaignInput {
  campaignId: string;
  expectedLockVersion: number;
  deployment: {
    id: string;
    campaignVersionId: string;
    manifest: DeploymentManifest;
    manifestHash: string;
    publishedBy: string;
  };
  /** Gerado fora; só é gravado na PRIMEIRA publicação (§4.3). */
  publicIdIfFirst: string;
  audit: AuditEntry;
}

export interface CampaignRepository {
  /** Cria Campaign + primeira versão + change + auditoria, atômico. */
  create(context: TenantContext, input: CreateCampaignInput): Promise<CampaignWithVersion>;

  /** Nova versão + ponteiro + change + auditoria, com lock otimista. */
  updateStrategy(context: TenantContext, input: UpdateCampaignInput): Promise<CampaignWithVersion>;

  /**
   * Vincula ou desvincula o agente.
   *
   * NÃO cria versão: o binding é uma coluna relacional, não parte do documento
   * canônico da estratégia. Versionar isso misturaria "o que a campanha é" com
   * "quem a executa".
   */
  bindAgent(context: TenantContext, input: BindAgentInput): Promise<CampaignRecord>;

  findById(context: TenantContext, id: string): Promise<CampaignWithVersion | null>;

  list(
    context: TenantContext,
    filter: { projectId?: string; agentId?: string },
    limit: number,
    cursor: string | null,
  ): Promise<CampaignRecord[]>;

  listVersions(
    context: TenantContext,
    campaignId: string,
    limit: number,
  ): Promise<CampaignVersionRecord[]>;

  /** Publica: novo deployment ACTIVE, anterior SUPERSEDED, tudo numa transação. */
  publish(context: TenantContext, input: PublishCampaignInput): Promise<DeploymentRecord>;

  listDeployments(
    context: TenantContext,
    campaignId: string,
    limit: number,
  ): Promise<DeploymentRecord[]>;

  findActiveDeployment(
    context: TenantContext,
    campaignId: string,
  ): Promise<DeploymentRecord | null>;
}

/**
 * O endereço público até a configuração CONGELADA.
 *
 * Esta é a única consulta do sistema que roda ANTES de existir um tenant — o
 * `accountId` é o que ela devolve, não o que ela recebe. Por isso ela é
 * estreita de propósito: busca por `publicId`, exige deployment ATIVO, e não
 * aceita nenhum outro filtro de fora. Uma consulta pública genérica seria a
 * porta dos fundos do multi-tenant.
 *
 * Depois dela, tudo volta ao normal: `publicTenantContext(accountId)` e o
 * guard do Prisma valendo como em qualquer outro caminho.
 */
export interface PublicDeploymentLookup {
  findActiveByPublicId(publicId: string): Promise<{
    accountId: string;
    /** Ids do que a publicação congelou. A SESSÃO nasce ligada a eles (§8). */
    campaignId: string;
    deploymentId: string;
    projectId: string;
    agentId: string;
    campaignName: string;
    agent: CanonicalAgent;
    campaign: CanonicalCampaign;
    project: CanonicalProjectProfile | null;
    /** Marca congelada. Nula em deployment publicado antes do manifest v2. */
    brand: CanonicalBrandIdentity | null;
    knowledgeSnapshotId: string | null;
  } | null>;
}
