import { campaignPublishBlockers, paginationQuerySchema, summarizeCampaign } from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseBody, parseParams, parseQuery } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { AgentRepository } from '../../agents/domain/repositories.js';
import type { BindCampaignAgentUseCase } from '../application/bind-campaign-agent.use-case.js';
import type { PublishCampaignUseCase } from '../application/publish-campaign.use-case.js';
import type { CampaignRecord, CampaignRepository } from '../domain/repositories.js';

export interface CampaignsRouterDependencies {
  tokens: TokenService;
  campaigns: CampaignRepository;
  agents: AgentRepository;
  publish: PublishCampaignUseCase;
  bindAgent: BindCampaignAgentUseCase;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

const listQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().length(26).optional(),
  agentId: z.string().length(26).optional(),
});

const bindAgentSchema = z.object({
  /** `null` desvincula. */
  agentId: z.string().length(26).nullable(),
});

function toListItem(campaign: CampaignRecord) {
  return {
    id: campaign.id,
    projectId: campaign.projectId,
    agentId: campaign.agentId,
    name: campaign.name,
    slug: campaign.slug,
    status: campaign.status,
    publicId: campaign.publicId,
    createdAt: campaign.createdAt.toISOString(),
    heroImageUrl: campaign.heroImageAssetId ? `/api/media/${campaign.heroImageAssetId}` : null,
  };
}

export function createCampaignsRouter(deps: CampaignsRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.get('/campaigns', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { limit, cursor, projectId, agentId } = parseQuery(listQuerySchema, request);

    const items = await deps.campaigns.list(
      tenant,
      {
        ...(projectId ? { projectId } : {}),
        ...(agentId ? { agentId } : {}),
      },
      limit,
      cursor ?? null,
    );

    response.json({
      items: items.map(toListItem),
      nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null,
    });
  });

  router.get('/campaigns/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const found = await deps.campaigns.findById(tenant, id);
    if (!found) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

    const agent = found.campaign.agentId
      ? await deps.agents.findById(tenant, found.campaign.agentId)
      : null;

    const active = await deps.campaigns.findActiveDeployment(tenant, id);

    response.json({
      ...toListItem(found.campaign),
      lockVersion: found.campaign.lockVersion,
      agent: agent ? { id: agent.agent.id, name: agent.agent.name, role: agent.agent.role } : null,
      strategy: found.version
        ? {
            versionNumber: found.version.versionNumber,
            canonical: found.version.canonicalConfig,
            summary: summarizeCampaign(found.version.canonicalConfig),
            createdAt: found.version.createdAt.toISOString(),
          }
        : null,
      // O que impede a publicação, calculado no MESMO código que a publicação
      // usa para recusar — a tela nunca diz "pode publicar" e a API discorda.
      publishBlockers: [
        ...(found.campaign.agentId ? [] : ['A campanha ainda não tem um agente vinculado.']),
        ...(found.version ? campaignPublishBlockers(found.version.canonicalConfig) : []),
      ],
      activeDeployment: active
        ? {
            id: active.id,
            deploymentNumber: active.deploymentNumber,
            manifestHash: active.manifestHash,
            publishedAt: active.publishedAt.toISOString(),
          }
        : null,
    });
  });

  router.get('/campaigns/:id/versions', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const campaign = await deps.campaigns.findById(tenant, id);
    if (!campaign) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

    const versions = await deps.campaigns.listVersions(tenant, id, 50);

    response.json({
      items: versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        source: version.source,
        reason: version.reason,
        createdAt: version.createdAt.toISOString(),
      })),
    });
  });

  /**
   * Vínculo do agente — o mesmo use case que o S.O chama como ação do sistema.
   * O vínculo não passa por modelo; quem passa é a decisão de QUAL, quando o
   * pedido vem pelo painel.
   */
  router.put('/campaigns/:id/agent', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);
    const { agentId } = parseBody(bindAgentSchema, request);

    response.json(toListItem(await deps.bindAgent.execute(tenant, id, agentId)));
  });

  /** Publica: congela o manifest. Ver §4.3. */
  router.post('/campaigns/:id/deployments', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const result = await deps.publish.execute(tenant, id);

    response.status(201).json({
      id: result.deployment.id,
      deploymentNumber: result.deployment.deploymentNumber,
      status: result.deployment.status,
      manifestHash: result.deployment.manifestHash,
      publicId: result.publicId,
      publishedAt: result.deployment.publishedAt.toISOString(),
    });
  });

  router.get('/campaigns/:id/deployments', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const campaign = await deps.campaigns.findById(tenant, id);
    if (!campaign) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

    const deployments = await deps.campaigns.listDeployments(tenant, id, 50);

    response.json({
      items: deployments.map((deployment) => ({
        id: deployment.id,
        deploymentNumber: deployment.deploymentNumber,
        status: deployment.status,
        manifestHash: deployment.manifestHash,
        manifest: deployment.manifest,
        publishedAt: deployment.publishedAt.toISOString(),
        supersededAt: deployment.supersededAt?.toISOString() ?? null,
      })),
    });
  });

  return router;
}
