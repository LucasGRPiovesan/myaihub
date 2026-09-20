import { campaignPublishBlockers } from '@myaihub/shared';
import type { IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';
import type { ModelRouter } from '../../ai/application/model-router.js';
import type { AgentRepository } from '../../agents/domain/repositories.js';
import type { BrandIdentityRepository } from '../../projects/domain/brand-repositories.js';
import type { ManageKnowledgeUseCase } from '../../projects/application/manage-knowledge.use-case.js';
import type { ProjectRepository } from '../../projects/domain/repositories.js';
import {
  CURRENT_MANIFEST_VERSION,
  hashManifest,
  type DeploymentManifest,
} from '../domain/manifest.js';
import type { CampaignRepository, DeploymentRecord } from '../domain/repositories.js';

/** Versões dos compiladores congeladas no manifest, para o trace ser reprodutível. */
const RUNTIME_VERSION = '1.0.0';
const CONTEXT_COMPILER_VERSION = '1.0.0';
const PROMPT_COMPILER_VERSION = '1.0.0';

export interface PublishCampaignResult {
  deployment: DeploymentRecord;
  publicId: string;
}

/**
 * Publica uma campanha congelando um `DeploymentManifest` (§4.3).
 *
 * O ponto do caso de uso é NEGAR: publicar é a única ação do produto que expõe
 * o trabalho do usuário a terceiros, e o que estiver errado aqui só aparece
 * numa conversa real com um cliente real. Por isso a validação é anterior e
 * explícita, e não uma checagem no runtime do chat.
 */
export class PublishCampaignUseCase {
  constructor(
    private readonly deps: {
      campaigns: CampaignRepository;
      projects: ProjectRepository;
      brands: BrandIdentityRepository;
      knowledge: ManageKnowledgeUseCase;
      agents: AgentRepository;
      router: ModelRouter;
      ids: IdGenerator;
    },
  ) {}

  async execute(context: TenantContext, campaignId: string): Promise<PublishCampaignResult> {
    const found = await this.deps.campaigns.findById(context, campaignId);
    if (!found) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

    const { campaign, version } = found;

    if (!version) {
      throw new AppError('VALIDATION_ERROR', 'A campanha ainda não tem estratégia definida.', {
        httpStatus: 422,
      });
    }

    if (!campaign.agentId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Vincule um agente à campanha antes de publicar — é ele quem vai conversar.',
        { httpStatus: 422 },
      );
    }

    const agent = await this.deps.agents.findById(context, campaign.agentId);
    if (!agent?.version) {
      throw new AppError(
        'VALIDATION_ERROR',
        'O agente vinculado ainda não tem configuração salva.',
        { httpStatus: 422 },
      );
    }

    const project = await this.deps.projects.findById(context, campaign.projectId);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

    const blockers = campaignPublishBlockers(version.canonicalConfig);
    if (blockers.length > 0) {
      throw new AppError('VALIDATION_ERROR', blockers.join(' '), {
        httpStatus: 422,
        details: { blockers },
      });
    }

    // Resolvido AQUI, não em runtime: se o roteamento mudar amanhã, uma conversa
    // em andamento não pode trocar de modelo no meio do atendimento (§4.3).
    const route = this.deps.router.routeFor('agent.runtime');

    // A MARCA e o CONHECIMENTO congelam junto (manifest v2).
    //
    // Sem eles a publicação era imutável só pela metade: a página trocava de
    // cor porque alguém editou a marca noutra tela, e o agente respondia com
    // um conteúdo reindexado hoje de manhã. "O que o público está vendo"
    // inclui o que ele LÊ e o que o agente SABE, não só o que o agente é.
    const brand = await this.deps.brands.findCurrent(context, project.project.id);

    // O snapshot é criado NA PUBLICAÇÃO, não reaproveitado: reaproveitar o
    // último faria uma fonte adicionada depois dele nunca entrar no ar, e o
    // usuário não teria como saber por quê.
    const knowledgeSnapshotId = await this.deps.knowledge.snapshot(context, project.project.id);

    // Congela os checkers determinísticos de agente e campanha. O runtime lê
    // desta lista — não re-resolve o registry, que pode ter mudado.
    const ruleChecks = [
      ...collectChecks(agent.version.canonicalConfig),
      ...collectChecks(version.canonicalConfig),
    ];

    const manifest: DeploymentManifest = {
      manifestVersion: CURRENT_MANIFEST_VERSION,
      campaignId: campaign.id,
      campaignVersionId: version.id,
      agentId: agent.agent.id,
      agentVersionId: agent.version.id,
      projectId: project.project.id,
      projectProfileVersionId: project.profile?.id ?? null,
      brandIdentityVersionId: brand?.id ?? null,
      knowledgeSnapshotId,
      runtimeVersion: RUNTIME_VERSION,
      contextCompilerVersion: CONTEXT_COMPILER_VERSION,
      promptCompilerVersion: PROMPT_COMPILER_VERSION,
      canonicalSchemaVersions: {
        agent: agent.version.canonicalConfig.canonicalSchemaVersion,
        campaign: version.canonicalConfig.canonicalSchemaVersion,
        projectProfile: project.profile?.canonicalConfig.canonicalSchemaVersion ?? null,
        brandIdentity: brand?.canonicalConfig.canonicalSchemaVersion ?? null,
      },
      providerConfig: {
        role: 'agent.runtime',
        provider: route.provider,
        model: route.model,
        generationParams: { temperature: 0.6 },
      },
      ruleChecks,
    };

    const deployment = await this.deps.campaigns.publish(context, {
      campaignId: campaign.id,
      expectedLockVersion: campaign.lockVersion,
      deployment: {
        id: this.deps.ids.generate(),
        campaignVersionId: version.id,
        manifest,
        manifestHash: hashManifest(manifest),
        publishedBy: context.userId ?? 'system',
      },
      publicIdIfFirst: this.deps.ids.generate(),
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: 'campaign.published',
        entityType: 'Campaign',
        entityId: campaign.id,
        metadata: {
          manifestHash: hashManifest(manifest),
          agentId: agent.agent.id,
          knowledgeSnapshotId,
          brandIdentityVersionId: brand?.id ?? null,
        },
      },
    });

    const republished = await this.deps.campaigns.findById(context, campaign.id);

    return {
      deployment,
      // O publicId da primeira publicação é preservado nas seguintes.
      publicId: republished?.campaign.publicId ?? '',
    };
  }
}

/** Extrai os checkers determinísticos de qualquer documento canônico com facetas. */
function collectChecks(
  document: Record<string, unknown>,
): Array<{ name: string; params: unknown }> {
  const checks: Array<{ name: string; params: unknown }> = [];

  for (const value of Object.values(document)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const check = (item as { check?: { name: string; params: unknown } }).check;
      if (check?.name) checks.push({ name: check.name, params: check.params });
    }
  }

  return checks;
}
