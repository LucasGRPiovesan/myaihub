import { z } from 'zod';

/**
 * Conversas persistidas (§8, Fase 8).
 *
 * O que muda em relação ao que existia: o histórico deixa de vir do CLIENTE. Ele
 * vinha de lá por falta desta fase, e isso tinha três consequências que só
 * pareciam pequenas — recarregar a página perdia a conversa, o servidor
 * confiava no cliente para dizer o que ele mesmo tinha respondido, e não havia
 * o que medir na Fase 10. Agora o cliente manda um `sessionId`; o histórico é
 * lido do banco.
 */

export const CONVERSATION_CHANNELS = ['PUBLIC', 'LAB'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_ROLES = ['VISITOR', 'AGENT'] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

export const SESSION_EVENT_TYPES = [
  'SESSION_STARTED',
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
  'RULE_VIOLATION',
  'CTA_OFFERED',
  'OBJECTIVE_REACHED',
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export const SESSION_EVENT_LABELS: Record<SessionEventType, string> = {
  SESSION_STARTED: 'Conversa iniciada',
  MESSAGE_RECEIVED: 'Mensagem recebida',
  MESSAGE_SENT: 'Resposta enviada',
  RULE_VIOLATION: 'Regra violada',
  CTA_OFFERED: 'CTA oferecido',
  OBJECTIVE_REACHED: 'Objetivo alcançado',
};

/** Quantas falas do histórico entram no contexto de um turno. */
export const CONVERSATION_HISTORY_WINDOW = 24;

export interface ConversationTurnView {
  role: ConversationRole;
  content: string;
  violations: Array<{ check: string; message: string }>;
  createdAt: string;
}

export interface ConversationSessionView {
  id: string;
  channel: ConversationChannel;
  campaignId: string | null;
  agentId: string;
  projectId: string | null;
  scenario: string | null;
  messageCount: number;
  totalTokens: number;
  costMicros: number;
  violationCount: number;
  startedAt: string;
  lastMessageAt: string;
}

/**
 * Patch de `ConversationState` proposto pelo modelo.
 *
 * TIPADO e limitado de propósito: o §8 diz que o estado nunca é sobrescrito por
 * inteiro pelo LLM. É a mesma regra da invariante 6 um nível abaixo — ali o
 * modelo propõe mutação de configuração, aqui propõe fato de conversa, e nos
 * dois casos quem aplica é o código.
 */
/**
 * A chave do fato, normalizada em vez de recusada.
 *
 * O modelo escreve "Prazo de entrega" ou "budget.Max" e o `regex` derrubava a
 * SAÍDA INTEIRA — inclusive o veredito de aderência, que é o motivo da
 * chamada. Medido no banco: duas recusas por causa disto, cada uma pagando um
 * turno de correção por um rótulo de dicionário.
 *
 * É a mesma regra que o aplicador de mutações já segue: campo que o modelo
 * erra na FORMA não descarta o conteúdo. `z.preprocess` porque ele sobrevive
 * ao `z.toJSONSchema`, ao contrário de `.transform()`.
 */
const factKeySchema = z.preprocess(
  (valor) =>
    typeof valor === 'string'
      ? valor
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9.]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 60)
      : valor,
  z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/),
);

/**
 * Entrada malformada é DESCARTADA, não derruba a lista.
 *
 * Medido: o modelo devolveu dois sinais sem `note`, e a saída inteira foi
 * recusada — o veredito de aderência junto. O estado é informação ACESSÓRIA
 * pegando carona numa chamada que existe para auditar a resposta; perder a
 * auditoria por causa dele inverte a prioridade.
 */
const descartarMalformados =
  (chaves: string[]) =>
  (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.filter(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        chaves.every((chave) => {
          const campo = (item as Record<string, unknown>)[chave];
          return typeof campo === 'string' && campo.trim().length > 0;
        }),
    );
  };

export const conversationStatePatchSchema = z.object({
  /** Fatos que o visitante DECLAROU sobre si. Nunca deduzidos. */
  facts: z
    .preprocess(
      descartarMalformados(['key', 'value']),
      z.array(z.object({ key: factKeySchema, value: z.string().trim().min(1).max(300) })).max(30),
    )
    .default([]),
  signals: z
    .preprocess(
      descartarMalformados(['kind', 'note']),
      z
        .array(
          z.object({
            kind: z.enum(['INTEREST', 'OBJECTION', 'URGENCY', 'DISQUALIFIER']),
            note: z.string().trim().min(1).max(300),
          }),
        )
        .max(20),
    )
    .default([]),
  /** 0–100. O modelo estima; o dashboard mostra como DECLARADO, não medido. */
  progressPercent: z.number().int().min(0).max(100).optional(),
  objectiveReached: z.boolean().optional(),
});

export type ConversationStatePatch = z.infer<typeof conversationStatePatchSchema>;

export interface ConversationStateView {
  facts: Array<{ key: string; value: string }>;
  signals: Array<{ kind: string; note: string }>;
  progress: { percent: number; objectiveReached: boolean };
}

export function emptyConversationState(): ConversationStateView {
  return { facts: [], signals: [], progress: { percent: 0, objectiveReached: false } };
}
