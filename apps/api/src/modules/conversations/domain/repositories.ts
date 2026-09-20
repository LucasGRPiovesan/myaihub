import type {
  ConversationChannel,
  ConversationRole,
  ConversationStateView,
  SessionEventType,
} from '@myaihub/shared';
import type { TenantContext } from '../../../shared/application/tenant-context.js';

/**
 * Porta de persistência das conversas (§8, Fase 8).
 *
 * O que esta fase muda no sistema inteiro: o histórico deixa de ser do CLIENTE.
 * Enquanto ele vinha de lá, o servidor acreditava no navegador sobre o que ele
 * mesmo tinha respondido — e recarregar a página apagava a conversa de um
 * cliente real no meio do atendimento.
 */

export interface SessionRecord {
  id: string;
  accountId: string;
  channel: ConversationChannel;
  campaignId: string | null;
  deploymentId: string | null;
  projectId: string | null;
  agentId: string;
  scenario: string | null;
  messageCount: number;
  totalTokens: number;
  costMicros: number;
  violationCount: number;
  startedAt: Date;
  lastMessageAt: Date;
}

export interface MessageRecord {
  id: string;
  seq: number;
  role: ConversationRole;
  content: string;
  violations: Array<{ check: string; message: string }>;
  createdAt: Date;
}

export interface StartSessionInput {
  id: string;
  /** Id do SESSION_STARTED. Vem do gerador, como todo id: derivar do id da
   *  sessão produziria colisão no dia em que outro evento precisar do mesmo truque. */
  startEventId: string;
  channel: ConversationChannel;
  campaignId: string | null;
  deploymentId: string | null;
  projectId: string | null;
  agentId: string;
  scenario: string | null;
}

/**
 * Um turno gravado: a fala do visitante, a resposta, o uso e os eventos.
 *
 * Vai tudo numa chamada — e numa transação — de propósito. Gravar a pergunta
 * numa ida e a resposta noutra deixa a janela em que a conversa persistida
 * mostra uma pergunta sem resposta; e é justamente nessa janela que o usuário
 * recarrega a página, porque foi a lentidão que o levou a recarregar.
 */
export interface RecordTurnInput {
  sessionId: string;
  visitor: { id: string; content: string } | null;
  agent: {
    id: string;
    content: string;
    violations: Array<{ check: string; message: string }>;
    aiCallId: string | null;
  };
  usage: { totalTokens: number; costMicros: number };
  events: Array<{
    id: string;
    type: SessionEventType;
    source: 'OBSERVED' | 'DECLARED';
    payload?: Record<string, unknown>;
  }>;
  state: ConversationStateView | null;
}

export interface SessionRepository {
  start(context: TenantContext, input: StartSessionInput): Promise<SessionRecord>;

  findById(context: TenantContext, id: string): Promise<SessionRecord | null>;

  /** As últimas `limit` falas, em ordem cronológica. */
  history(context: TenantContext, sessionId: string, limit: number): Promise<MessageRecord[]>;

  state(context: TenantContext, sessionId: string): Promise<ConversationStateView | null>;

  /** Falas + contadores + eventos + estado, numa transação. */
  recordTurn(context: TenantContext, input: RecordTurnInput): Promise<void>;

  /**
   * Acrescenta à fala já gravada o que o auditor encontrou DEPOIS.
   *
   * A conferência de regras deixou de segurar a resposta: ela roda atrás e,
   * quando termina, precisa voltar ao turno que já está no banco. Escrita
   * ESCOPADA por conta — `updateMany` com `accountId` no `where` —, porque a
   * suíte de integração usa o client cru e não pegaria a forma singular.
   */
  attachAdherence(
    context: TenantContext,
    input: {
      sessionId: string;
      messageId: string;
      violations: Array<{ check: string; message: string }>;
      events: Array<{
        id: string;
        type: SessionEventType;
        source: 'OBSERVED' | 'DECLARED';
        payload?: Record<string, unknown>;
      }>;
      state: ConversationStateView | null;
    },
  ): Promise<void>;

  list(
    context: TenantContext,
    filter: {
      channel?: ConversationChannel;
      campaignId?: string;
      agentId?: string;
      limit: number;
      cursor: string | null;
    },
  ): Promise<SessionRecord[]>;
}
