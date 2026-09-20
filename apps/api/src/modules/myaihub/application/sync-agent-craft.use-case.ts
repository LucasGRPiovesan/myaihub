import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { AgentRepository } from '../../agents/domain/repositories.js';
import { CORE_PLAYBOOK_KEY } from '../domain/playbook.js';
import { playbookFloorMutations, preserveEnforcement } from '../domain/playbook-floor.js';
import type { PlaybookRepository } from '../domain/repositories.js';
import type {
  ApplyManualMutationsResult,
  ApplyManualMutationsUseCase,
} from './apply-manual-mutations.use-case.js';

/**
 * Põe o agente em dia com o ofício. SEM chamar modelo.
 *
 * Sincronizar não é uma conversa: o texto do playbook é curado por uma pessoa,
 * e aplicá-lo é mutação tipada. Passar por modelo custava três coisas —
 * tokens, latência e precisão: ele PARAFRASEAVA o princípio (682 chars do
 * playbook chegaram como 380, com o caso do momento dentro) e, quando
 * classificava o pedido como pergunta em vez de ordem, não aplicava nada e a
 * tela dizia "concluído" sem ter mudado uma linha.
 *
 * Pela mesma porta de escrita do resto: `applyManual` monta versão, audita e
 * versiona igual (§7.2). O que o usuário calibrou por cima não se perde — o
 * piso REFINA no lugar pela chave semântica, e item que ele criou não é tocado.
 *
 * Saiu da rota porque tem dois chamadores: o botão da tela e o S.O.
 */
export class SyncAgentCraftUseCase {
  constructor(
    private readonly deps: {
      agents: AgentRepository;
      playbooks: PlaybookRepository;
      applyManual: ApplyManualMutationsUseCase;
    },
  ) {}

  async execute(context: TenantContext, agentId: string): Promise<ApplyManualMutationsResult> {
    const found = await this.deps.agents.findById(context, agentId);
    if (!found?.version) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

    const chave = found.version.canonicalConfig.playbookKey;
    const conduta = await this.deps.playbooks.findCurrent(CORE_PLAYBOOK_KEY);
    const oficio = chave ? await this.deps.playbooks.findCurrent(chave) : null;

    const playbooks = [conduta, oficio].filter((item) => item !== null);
    const mutations = preserveEnforcement(
      playbookFloorMutations(playbooks.map((item) => item.playbook)),
      found.version.canonicalConfig as unknown as Record<string, unknown>,
    );

    if (mutations.length === 0) {
      throw new NotFoundError('NOT_FOUND', 'Este agente não tem playbook de ofício.');
    }

    return this.deps.applyManual.execute(context, {
      targetType: 'AGENT',
      targetId: agentId,
      mutations: mutations as never,
      reason: `Sincronizado com o ofício (${playbooks
        .map((item) => `${item.playbook.label} v${item.versionNumber}`)
        .join(', ')}).`,
    });
  }
}
