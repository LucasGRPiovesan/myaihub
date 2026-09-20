import { z } from 'zod';

/**
 * Contratos do MyAIHub OS expostos ao frontend (§53, §65).
 */

/** Escopo da conversa: define qual contexto o OS carrega. */
export const HUB_SCOPES = ['ROOT', 'PROJECT', 'AGENT', 'CAMPAIGN', 'PLAYBOOK'] as const;
export type HubScope = (typeof HUB_SCOPES)[number];

export const HUB_OPERATION_STATUSES = [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'AWAITING_CONFIRMATION',
] as const;
export type HubOperationStatus = (typeof HUB_OPERATION_STATUSES)[number];

/**
 * USER_DIRECTED  o usuário pediu; o OS aplica e comunica.
 * AI_SUGGESTED   o OS identificou uma oportunidade; exige confirmação antes de
 *                persistir. Nunca reescrever configuração por conta própria (§65).
 */
export const APPLY_MODES = ['USER_DIRECTED', 'AI_SUGGESTED'] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];

export const sendHubMessageSchema = z.object({
  content: z.string().trim().min(1, 'Escreva alguma coisa.').max(4000),
  /** Operação sugerida pela UI (quick action). O router pode discordar. */
  operation: z.string().max(60).optional(),
  /**
   * A operação foi ESCOLHIDA pelo usuário (clique numa ação), não só oferecida
   * pela tela.
   *
   * As duas vão ao roteador como pista, mas só a escolhida justifica anunciar
   * "entendi diferente" quando ele decide outra coisa. Sem a pista da tela, o
   * roteador perdia contexto — "crie um projeto a partir deste link" numa conta
   * vazia virou cadastro de conhecimento; com ela anunciada sempre, todo turno
   * ganhava uma nota de "troca" que ninguém tinha pedido.
   */
  operationPicked: z.boolean().optional(),
  /**
   * MediaAssets colados no painel.
   *
   * Ids, não bytes: o upload já aconteceu quando o usuário colou, então o envio
   * da mensagem continua leve e a imagem sobrevive a um erro de operação.
   */
  attachmentIds: z.array(z.string().length(26)).max(4).optional(),
  /**
   * Playbook de ofício escolhido no briefing, ao CRIAR um agente.
   *
   * Viaja aqui porque a classificação já aconteceu — refazê-la na criação seria
   * pagar duas vezes pela mesma decisão e correr o risco de ela sair diferente.
   * O servidor valida a chave contra o catálogo; chave inventada é ignorada.
   */
  playbookKey: z.string().trim().max(60).optional(),
  /**
   * A conversa de teste em andamento, quando o escopo é de um AGENTE.
   *
   * O OS lê o que de fato aconteceu em vez de depender da descrição do usuário.
   * Vai limitado: contexto pago, e o que importa para diagnosticar um
   * comportamento são os últimos turnos, não a conversa inteira.
   */
  /**
   * "Atualizar pelo ofício": reaplica o piso do playbook sobre o agente.
   *
   * Sem isto a propagação passava só pelo modelo, que PARAFRASEIA — e o
   * princípio curado virava uma versão dele, com o caso do momento dentro.
   * Medido: o texto do playbook sobre não deduzir o vínculo chegou ao agente
   * como uma regra sobre "preposições".
   */
  syncCraft: z.boolean().optional(),
  testTranscript: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(12)
    .optional(),
});
export type SendHubMessageRequest = z.infer<typeof sendHubMessageSchema>;

export const startHubConversationSchema = z.object({
  scope: z.enum(HUB_SCOPES),
  /** Entidade do escopo (projectId, agentId, campaignId). Ausente em ROOT. */
  scopeId: z.string().max(40).optional(),
  title: z.string().trim().max(120).optional(),
});
export type StartHubConversationRequest = z.infer<typeof startHubConversationSchema>;

export interface HubAttachmentView {
  id: string;
  url: string;
  mimeType: string;
  fileName: string;
  width: number | null;
  height: number | null;
}

export interface HubMessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  attachments?: HubAttachmentView[];
  createdAt: string;
}

export interface HubConversationView {
  id: string;
  scope: HubScope;
  scopeId: string | null;
  title: string | null;
  messages: HubMessageView[];
}

export interface HubOperationView {
  id: string;
  conversationId: string;
  operation: string;
  status: HubOperationStatus;
  /** Canal SSE onde os eventos desta operação são publicados. */
  channel: string;
  createdAt: string;
}

/** O que mudou, em linguagem humana, para o usuário conferir. */
export interface ConfigurationChangeView {
  id: string;
  entityType: string;
  entityId: string;
  interpretedIntent: string;
  rationale: string;
  fromVersion: number | null;
  toVersion: number;
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  createdAt: string;
}
