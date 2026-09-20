import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { CampaignRecord, CampaignRepository } from '../domain/repositories.js';

/**
 * Quem atende a campanha.
 *
 * Morava dentro da rota, e por isso o S.O não tinha como fazer: pedido "vincula
 * o Alex no Sankar", ele respondeu explicando onde clicar. Use case próprio
 * porque são DOIS chamadores — a tela e o S.O — e o vínculo tem que ser o mesmo
 * nos dois, com a mesma auditoria e o mesmo lock.
 */
export class BindCampaignAgentUseCase {
  constructor(private readonly deps: { campaigns: CampaignRepository }) {}

  /** `agentId` nulo desvincula. */
  async execute(
    context: TenantContext,
    campaignId: string,
    agentId: string | null,
  ): Promise<CampaignRecord> {
    const found = await this.deps.campaigns.findById(context, campaignId);
    if (!found) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

    return this.deps.campaigns.bindAgent(context, {
      campaignId,
      expectedLockVersion: found.campaign.lockVersion,
      agentId,
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: agentId ? 'campaign.agent_bound' : 'campaign.agent_unbound',
        entityType: 'Campaign',
        entityId: campaignId,
        metadata: { agentId },
      },
    });
  }
}
