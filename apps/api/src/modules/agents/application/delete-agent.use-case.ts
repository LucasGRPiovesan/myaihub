import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';
import type { CampaignRepository } from '../../campaigns/domain/repositories.js';
import type { AgentRepository } from '../domain/repositories.js';

export interface DeleteAgentBlocker {
  kind: 'CAMPAIGN' | 'DEPLOYMENT';
  campaignId: string;
  campaignName: string;
  projectId: string;
}

/**
 * Exclui um agente, ou explica por que não dá.
 *
 * Duas consistências diferentes, e só a segunda é irreversível:
 *
 *   VÍNCULO — uma campanha aponta para o agente. Desvincular é um clique, e é
 *   decisão do usuário: apagar o agente por baixo dela deixaria a campanha sem
 *   quem conversa, descoberto só na hora de publicar.
 *
 *   PUBLICAÇÃO NO AR — um deployment ATIVO congelou a versão deste agente no
 *   manifest. As versões somem junto com o agente (cascade), então apagar
 *   quebraria um chat que está atendendo gente neste momento. Isto não é
 *   negociável nem com confirmação: despublique primeiro.
 */
export class DeleteAgentUseCase {
  constructor(
    private readonly deps: {
      agents: AgentRepository;
      campaigns: CampaignRepository;
      audit: AuditWriter;
    },
  ) {}

  /** O que impede a exclusão. Vazio = pode excluir. */
  async blockers(context: TenantContext, agentId: string): Promise<DeleteAgentBlocker[]> {
    const bound = await this.deps.campaigns.list(context, { agentId }, 100, null);
    const blockers: DeleteAgentBlocker[] = [];

    for (const campaign of bound) {
      const active = await this.deps.campaigns.findActiveDeployment(context, campaign.id);

      blockers.push({
        // Publicação no ar é mais grave que vínculo, e a UI precisa distinguir:
        // um se resolve desvinculando, o outro exige despublicar.
        kind: active?.manifest.agentId === agentId ? 'DEPLOYMENT' : 'CAMPAIGN',
        campaignId: campaign.id,
        campaignName: campaign.name,
        projectId: campaign.projectId,
      });
    }

    return blockers;
  }

  async execute(context: TenantContext, agentId: string): Promise<void> {
    const found = await this.deps.agents.findById(context, agentId);
    if (!found) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

    const blockers = await this.blockers(context, agentId);

    if (blockers.length > 0) {
      const published = blockers.filter((item) => item.kind === 'DEPLOYMENT');
      const names = blockers.map((item) => item.campaignName).join(', ');

      throw new AppError(
        'CONFLICT',
        published.length > 0
          ? `Este agente está no ar em ${names}. Despublique a campanha antes de excluí-lo.`
          : `Este agente está vinculado a ${names}. Desvincule antes de excluí-lo.`,
        { httpStatus: 409, details: { blockers } },
      );
    }

    await this.deps.agents.delete(context, agentId);

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'agent.deleted',
      entityType: 'Agent',
      entityId: agentId,
      metadata: { name: found.agent.name },
    });
  }
}
