import { CONVERSATION_HISTORY_WINDOW, emptyConversationState } from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseParams, parseQuery } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { PendingAdherence } from '../application/pending-adherence.js';
import type { SessionRepository } from '../domain/repositories.js';

export interface ConversationsRouterDependencies {
  tokens: TokenService;
  sessions: SessionRepository;
  /** Onde o veredito da conferência espera até a tela buscá-lo. */
  pending: PendingAdherence;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

/**
 * Leitura das conversas persistidas (Fase 8).
 *
 * Só LEITURA. Quem escreve são os dois runtimes — Lab e chat público —, e uma
 * rota de escrita aqui seria um terceiro caminho para gravar conversa, livre
 * das regras determinísticas e da contagem de custo que os dois aplicam.
 */
export function createConversationsRouter(deps: ConversationsRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.get('/conversations', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const query = parseQuery(
      z.object({
        channel: z.enum(['PUBLIC', 'LAB']).optional(),
        campaignId: z.string().length(26).optional(),
        agentId: z.string().length(26).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().length(26).optional(),
      }),
      request,
    );

    const items = await deps.sessions.list(tenant, {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
      limit: query.limit,
      cursor: query.cursor ?? null,
    });

    response.json({
      items: items.map((session) => ({
        id: session.id,
        channel: session.channel,
        campaignId: session.campaignId,
        agentId: session.agentId,
        projectId: session.projectId,
        scenario: session.scenario,
        messageCount: session.messageCount,
        totalTokens: session.totalTokens,
        costMicros: session.costMicros,
        violationCount: session.violationCount,
        startedAt: session.startedAt.toISOString(),
        lastMessageAt: session.lastMessageAt.toISOString(),
      })),
      nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null,
    });
  });

  router.get('/conversations/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const session = await deps.sessions.findById(tenant, id);
    if (!session) throw new NotFoundError('NOT_FOUND', 'Conversa não encontrada.');

    const [messages, state] = await Promise.all([
      // O dobro da janela do runtime: aqui quem lê é uma pessoa revendo o
      // atendimento, e cortar no mesmo ponto em que o modelo corta esconderia
      // dela justamente o começo, que é onde a conversa se define.
      deps.sessions.history(tenant, id, CONVERSATION_HISTORY_WINDOW * 2),
      deps.sessions.state(tenant, id),
    ]);

    response.json({
      id: session.id,
      channel: session.channel,
      campaignId: session.campaignId,
      agentId: session.agentId,
      projectId: session.projectId,
      scenario: session.scenario,
      messageCount: session.messageCount,
      totalTokens: session.totalTokens,
      costMicros: session.costMicros,
      violationCount: session.violationCount,
      startedAt: session.startedAt.toISOString(),
      lastMessageAt: session.lastMessageAt.toISOString(),
      turns: messages.map((message) => ({
        role: message.role,
        content: message.content,
        violations: message.violations,
        createdAt: message.createdAt.toISOString(),
      })),
      state: state ?? emptyConversationState(),
    });
  });

  /**
   * O VEREDITO DA CONFERÊNCIA, buscado depois da resposta.
   *
   * A auditoria de regras deixou de segurar o turno — ela é uma SEGUNDA chamada
   * ao provider e dobrava a espera na tela por um dado acessório sobre uma
   * resposta já produzida e já paga. Agora a fala chega na hora, e a tela vem
   * aqui perguntar como foi.
   *
   * `CHECKING` é resposta legítima: significa "ainda estou conferindo", e é o
   * que faz a tela continuar perguntando em vez de decidir sozinha. `null` no
   * mapa vira `UNAVAILABLE` — não saber NUNCA pode virar selo verde, que é a
   * mentira que este endpoint existe para impedir.
   */
  router.get('/conversations/:id/turns/:turnId/adherence', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id, turnId } = parseParams(
      idParamSchema.extend({ turnId: z.string().length(26, 'Identificador inválido.') }),
      request,
    );

    // A sessão é conferida CONTRA A CONTA antes de qualquer coisa: sem isto,
    // um id de turno qualquer leria o veredito da conversa de outra pessoa.
    const session = await deps.sessions.findById(tenant, id);
    if (!session) throw new NotFoundError('NOT_FOUND', 'Conversa não encontrada.');

    const verdict = deps.pending.get(turnId);

    response.json({
      status: verdict?.status ?? 'UNAVAILABLE',
      violations: verdict?.violations ?? [],
    });
  });

  return router;
}
