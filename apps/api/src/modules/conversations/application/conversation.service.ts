import {
  CONVERSATION_HISTORY_WINDOW,
  type ConversationChannel,
  type ConversationStatePatch,
  type ConversationStateView,
} from '@myaihub/shared';
import type { IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import {
  deriveTurnEvents,
  mergeConversationState,
  objectiveJustReached,
  type TurnObservation,
} from '../domain/state.js';
import type { SessionRecord, SessionRepository } from '../domain/repositories.js';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * O serviço que os DOIS canais usam para conversar com estado (§8, Fase 8).
 *
 * Um só, e não um por canal: o Lab e o Public Chat fazem a mesma coisa —
 * carregar histórico, falar, gravar o turno — e dois serviços significariam que
 * a próxima correção chega num só. O que difere é o `channel`, e ele muda o que
 * a Fase 10 conta, não como a conversa é gravada.
 *
 * O histórico deixa de vir do cliente. Enquanto vinha, o servidor acreditava no
 * navegador sobre o que ele mesmo tinha respondido — e um recarregamento apagava
 * o atendimento de um cliente real no meio da conversa.
 */
export class ConversationService {
  constructor(
    private readonly deps: {
      sessions: SessionRepository;
      ids: IdGenerator;
    },
  ) {}

  /**
   * A sessão do turno: a que veio no request, ou uma nova.
   *
   * Sessão de outro agente/campanha é RECUSADA em vez de ignorada. Aceitar e
   * abrir outra devolveria ao cliente um `sessionId` diferente do que ele
   * mandou, e a conversa se partiria em duas sem nada dizendo isso.
   */
  async resolveSession(
    context: TenantContext,
    input: {
      sessionId: string | null;
      channel: ConversationChannel;
      agentId: string;
      campaignId: string | null;
      deploymentId: string | null;
      projectId: string | null;
      scenario: string | null;
    },
  ): Promise<SessionRecord> {
    if (input.sessionId) {
      const existing = await this.deps.sessions.findById(context, input.sessionId);
      if (!existing) {
        throw new NotFoundError('NOT_FOUND', 'Esta conversa não existe mais.');
      }
      if (existing.agentId !== input.agentId || existing.campaignId !== input.campaignId) {
        throw new NotFoundError('NOT_FOUND', 'Esta conversa é de outro atendimento.');
      }
      return existing;
    }

    return this.deps.sessions.start(context, {
      id: this.deps.ids.generate(),
      startEventId: this.deps.ids.generate(),
      channel: input.channel,
      agentId: input.agentId,
      campaignId: input.campaignId,
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      scenario: input.scenario,
    });
  }

  /** As últimas falas, no formato que o gateway consome. */
  async history(context: TenantContext, sessionId: string): Promise<ConversationTurn[]> {
    const messages = await this.deps.sessions.history(
      context,
      sessionId,
      CONVERSATION_HISTORY_WINDOW,
    );

    return messages.map((message) => ({
      role: message.role === 'VISITOR' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));
  }

  async state(context: TenantContext, sessionId: string): Promise<ConversationStateView | null> {
    return this.deps.sessions.state(context, sessionId);
  }

  async findSession(context: TenantContext, sessionId: string): Promise<SessionRecord | null> {
    return this.deps.sessions.findById(context, sessionId);
  }

  /**
   * O transcrito para EXIBIR, não para o modelo consumir.
   *
   * Janela maior que a do runtime: quem lê aqui é uma pessoa retomando o
   * atendimento, e cortar no mesmo ponto em que o modelo corta esconderia dela
   * justamente o começo, que é onde a conversa se define.
   */
  async transcript(
    context: TenantContext,
    sessionId: string,
  ): Promise<Array<{ role: 'VISITOR' | 'AGENT'; content: string }>> {
    const messages = await this.deps.sessions.history(
      context,
      sessionId,
      CONVERSATION_HISTORY_WINDOW * 2,
    );

    return messages.map((message) => ({ role: message.role, content: message.content }));
  }

  /**
   * Grava o turno inteiro: falas, uso, eventos e estado.
   *
   * O `statePatch` é opcional porque ele só existe quando alguma chamada já
   * paga o produziu (a validação semântica). Sem ela, o turno grava o que o
   * código OBSERVOU e nada mais — que é honesto: o resto seria uma chamada
   * extra por turno para adivinhar o que ninguém pediu.
   */
  async recordTurn(
    context: TenantContext,
    input: {
      /**
       * Só o id: quem chama acabou de resolver a sessão e não tem por que
       * carregar o registro inteiro por uma fronteira que não usa o resto.
       */
      session: { id: string };
      visitorMessage: string | null;
      turn: TurnObservation;
      usage: { totalTokens: number; costMicros: number };
      aiCallId: string | null;
      statePatch: ConversationStatePatch | null;
    },
    /**
     * O id da fala do agente, para quem precisa voltar a ela.
     *
     * Ele era gerado aqui dentro e morria aqui. Quem chama passou a precisar
     * dele desde que a conferência de regras deixou de segurar a resposta: é
     * por este id que a tela pergunta pelo veredito que chega depois.
     */
  ): Promise<{ agentMessageId: string }> {
    const events = deriveTurnEvents(input.turn).map((event) => ({
      id: this.deps.ids.generate(),
      ...event,
    }));

    let state: ConversationStateView | null = null;

    if (input.statePatch) {
      const before = await this.deps.sessions.state(context, input.session.id);
      state = mergeConversationState(before, input.statePatch);

      if (objectiveJustReached(before, state)) {
        events.push({
          id: this.deps.ids.generate(),
          type: 'OBJECTIVE_REACHED',
          source: 'DECLARED',
          payload: { percent: state.progress.percent },
        });
      }
    }

    const agentMessageId = this.deps.ids.generate();

    await this.deps.sessions.recordTurn(context, {
      sessionId: input.session.id,
      visitor: input.visitorMessage
        ? { id: this.deps.ids.generate(), content: input.visitorMessage }
        : null,
      agent: {
        id: agentMessageId,
        content: input.turn.reply,
        violations: input.turn.violations,
        aiCallId: input.aiCallId,
      },
      usage: input.usage,
      events,
      state,
    });

    return { agentMessageId };
  }

  /**
   * A conferência que chegou DEPOIS da resposta.
   *
   * O turno já foi gravado e já foi entregue ao usuário; isto acrescenta o que
   * o auditor encontrou. Só é chamado quando há algo a acrescentar — turno
   * limpo não volta ao banco para regravar o mesmo array.
   *
   * Os eventos de violação saem daqui e não do `recordTurn`, pelo mesmo motivo
   * de sempre: é UM evento por violação, porque o dashboard agrega por CHECKER
   * e um evento agregado obrigaria a abrir o payload para saber qual regra
   * falhou — que é a pergunta que a tela existe para responder.
   */
  async attachAdherence(
    context: TenantContext,
    input: {
      sessionId: string;
      messageId: string;
      /** TODAS as violações do turno — é isto que fica gravado na fala. */
      violations: Array<{ check: string; message: string }>;
      /**
       * Só as que o AUDITOR acrescentou.
       *
       * `recordTurn` já emitiu um evento para cada violação determinística que
       * conhecia na hora. Emitir a lista inteira de novo aqui contaria as
       * mesmas duas vezes no dashboard — que agrega justamente por checker.
       */
      newViolations: Array<{ check: string; message: string }>;
      statePatch: ConversationStatePatch | null;
    },
  ): Promise<void> {
    let state: ConversationStateView | null = null;
    const events = input.newViolations.map((violation) => ({
      id: this.deps.ids.generate(),
      type: 'RULE_VIOLATION' as const,
      source: 'OBSERVED' as const,
      payload: { check: violation.check, message: violation.message },
    }));

    if (input.statePatch) {
      const before = await this.deps.sessions.state(context, input.sessionId);
      state = mergeConversationState(before, input.statePatch);

      // O objetivo alcançado só vira evento na TRANSIÇÃO — o modelo o redeclara
      // em todo turno seguinte porque continua verdadeiro, e emitir a cada vez
      // inflaria a conversão de uma sessão em quantos turnos ela tiver depois.
      if (objectiveJustReached(before, state)) {
        events.push({
          id: this.deps.ids.generate(),
          type: 'OBJECTIVE_REACHED' as never,
          source: 'DECLARED' as never,
          payload: { percent: state.progress.percent } as never,
        });
      }
    }

    await this.deps.sessions.attachAdherence(context, {
      sessionId: input.sessionId,
      messageId: input.messageId,
      violations: input.violations,
      events,
      state,
    });
  }
}
