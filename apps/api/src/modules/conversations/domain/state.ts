import {
  emptyConversationState,
  type ConversationStatePatch,
  type ConversationStateView,
  type SessionEventType,
} from '@myaihub/shared';

/**
 * Estado e eventos de uma conversa (§8, §17 Fase 10).
 *
 * Duas fontes, e a diferença entre elas é o ponto:
 *
 * O que o CÓDIGO observa — a fala aconteceu, a resposta violou uma regra, o
 * link do CTA apareceu no texto — é medida. Vale sozinho.
 *
 * O que o MODELO declara — "a pessoa demonstrou interesse", "o objetivo foi
 * alcançado" — é opinião, e entra marcado como DECLARED. Misturar os dois faria
 * o dashboard exibir a leitura do modelo com a autoridade de um contador.
 */

export interface TurnObservation {
  reply: string;
  violations: Array<{ check: string; message: string }>;
  /** URL do CTA da campanha, quando existe. Presente no texto = CTA oferecido. */
  ctaUrl: string | null;
  /** Falso na abertura, em que não houve fala do visitante. */
  hadVisitorMessage: boolean;
}

export interface DerivedEvent {
  type: SessionEventType;
  source: 'OBSERVED' | 'DECLARED';
  payload?: Record<string, unknown>;
}

/**
 * Os eventos rastreáveis de um turno.
 *
 * `RULE_VIOLATION` sai um por violação, não um por turno: o dashboard agrega
 * por CHECKER, e um evento agregado obrigaria a abrir o payload para saber qual
 * regra falhou — que é justamente a pergunta que a tela precisa responder.
 */
export function deriveTurnEvents(turn: TurnObservation): DerivedEvent[] {
  const events: DerivedEvent[] = [];

  if (turn.hadVisitorMessage) events.push({ type: 'MESSAGE_RECEIVED', source: 'OBSERVED' });
  events.push({ type: 'MESSAGE_SENT', source: 'OBSERVED' });

  for (const violation of turn.violations) {
    events.push({
      type: 'RULE_VIOLATION',
      source: 'OBSERVED',
      payload: { check: violation.check, message: violation.message },
    });
  }

  // O CTA foi OFERECIDO quando o endereço aparece na resposta. Que ele tenha
  // sido CLICADO é outra coisa, e é o público quem sabe — medir clique exigiria
  // um redirecionador nosso, e prometer o número sem isso seria inventá-lo.
  if (turn.ctaUrl && turn.reply.includes(turn.ctaUrl)) {
    events.push({ type: 'CTA_OFFERED', source: 'OBSERVED', payload: { url: turn.ctaUrl } });
  }

  return events;
}

/**
 * Aplica o patch declarado pelo modelo sobre o estado atual.
 *
 * NUNCA sobrescreve por inteiro (§8). É a mesma regra da invariante 6 um nível
 * abaixo: ali o modelo propõe mutação de configuração, aqui propõe fato de
 * conversa, e nos dois casos quem aplica é o código.
 *
 * Fato existente é REFINADO pela chave, não duplicado — sem isso, cinco turnos
 * em que a pessoa repete o orçamento produziriam cinco fatos "budget".
 */
export function mergeConversationState(
  current: ConversationStateView | null,
  patch: ConversationStatePatch,
): ConversationStateView {
  const base = current ?? emptyConversationState();

  const facts = [...base.facts];
  for (const fact of patch.facts) {
    const index = facts.findIndex((existing) => existing.key === fact.key);
    if (index >= 0) facts[index] = fact;
    else facts.push(fact);
  }

  const signals = [...base.signals];
  for (const signal of patch.signals) {
    const duplicate = signals.some(
      (existing) => existing.kind === signal.kind && existing.note === signal.note,
    );
    if (!duplicate) signals.push(signal);
  }

  return {
    facts: facts.slice(-30),
    signals: signals.slice(-20),
    progress: {
      // Progresso NÃO retrocede por omissão: um turno em que o modelo não
      // declarou nada não significa que a conversa andou para trás.
      percent: Math.max(base.progress.percent, patch.progressPercent ?? 0),
      objectiveReached: base.progress.objectiveReached || (patch.objectiveReached ?? false),
    },
  };
}

/**
 * `OBJECTIVE_REACHED` só na TRANSIÇÃO.
 *
 * O modelo redeclara o objetivo alcançado em todo turno seguinte — ele continua
 * verdadeiro. Emitir o evento a cada vez inflaria a conversão de uma sessão em
 * quantos turnos ela tiver depois disso.
 */
export function objectiveJustReached(
  before: ConversationStateView | null,
  after: ConversationStateView,
): boolean {
  return after.progress.objectiveReached && !(before?.progress.objectiveReached ?? false);
}
