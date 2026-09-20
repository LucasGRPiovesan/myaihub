import type { HubEvent, HubScope } from '@myaihub/shared';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { AgentPlaybook } from './playbook.js';

export interface PolicyVersion {
  id: string;
  versionNumber: number;
  sections: Record<string, string>;
}

export interface PolicyRepository {
  /** Policy vigente. Global à plataforma, não pertence a tenant. */
  getCurrent(name: string): Promise<PolicyVersion | null>;
  /** Cria a v1 se ainda não existir. Idempotente. */
  ensureSeeded(name: string, sections: Record<string, string>): Promise<PolicyVersion>;
  /**
   * Põe a policy vigente em dia com o arquivo de seed, numa versão NOVA.
   *
   * Antes isto só ACRESCENTAVA seção nova, e nunca corrigia texto de seção
   * existente — "porque ela pode ter sido editada em produção". Só que não
   * existe caminho nenhum para editá-la: nem rota, nem método aqui. A proteção
   * guardava algo que não existe e bloqueava tudo o que existe, com o pior
   * sintoma possível: a correção ficava no código, o sistema seguia com o texto
   * velho, e ninguém tinha como notar. Duas vezes a mesma regra foi "corrigida"
   * sem nunca chegar ao modelo.
   *
   * Nada disso afrouxa a invariante 5: versão é IMUTÁVEL. Corrigir cria versão
   * nova, com o motivo dizendo o que mudou, e o ponteiro passa a apontar para
   * ela. O histórico continua contando a história inteira.
   *
   * Se um dia a Master Policy ganhar edição pela tela, aí sim seção curada
   * precisa de marca própria — e o seed passa a respeitá-la.
   */
  syncSections(
    name: string,
    sections: Record<string, string>,
  ): Promise<{ version: PolicyVersion; added: string[]; updated: string[] }>;
}

/**
 * Playbooks de ofício. Globais à plataforma, como a Master Policy.
 */
export interface PlaybookRepository {
  /** Todos os playbooks vigentes. É o catálogo que o classificador enxerga. */
  listCurrent(): Promise<AgentPlaybook[]>;
  findByKey(key: string): Promise<AgentPlaybook | null>;
  /**
   * O playbook vigente COM o número da versão.
   *
   * A versão é o que permite saber depois que o agente foi projetado sobre um
   * ofício mais antigo do que o de hoje. Sem ela a evolução do playbook seria
   * invisível: o agente continuaria consistente com um piso que já mudou, e
   * ninguém teria como perceber.
   */
  findCurrent(key: string): Promise<{ playbook: AgentPlaybook; versionNumber: number } | null>;
  /**
   * Cria os playbooks que ainda não existem. Aditivo: playbook já gravado nunca
   * é sobrescrito, porque o admin pode tê-lo editado.
   */
  seedMissing(playbooks: readonly AgentPlaybook[]): Promise<string[]>;
  /**
   * Registra um papel que não casou com nenhum playbook.
   *
   * É a pauta do admin. Sem isto a lacuna é invisível: o agente nasce genérico
   * e ninguém fica sabendo que faltou ofício.
   */
  recordMiss(context: TenantContext, role: string): Promise<void>;

  // --- administração da plataforma ---------------------------------------

  /** Playbooks com o número da versão vigente, para a listagem do admin. */
  listForAdmin(): Promise<
    Array<{ playbook: AgentPlaybook; versionNumber: number; updatedAt: Date }>
  >;
  /**
   * Grava uma versão NOVA. Versão é imutável: editar cria, nunca altera.
   *
   * Sem isso não haveria como voltar atrás numa curadoria ruim — e curadoria de
   * ofício erra, porque é opinião sobre como um profissional trabalha.
   */
  saveVersion(key: string, playbook: AgentPlaybook, reason: string): Promise<number>;
  history(key: string): Promise<Array<{ versionNumber: number; reason: string; createdAt: Date }>>;
  /**
   * Registra que uma correção de OFÍCIO foi aplicada num agente.
   *
   * Não altera playbook nenhum: é pauta. O usuário já recebeu o ajuste quando
   * isto é chamado — o registro existe para o padrão ficar visível ao admin
   * quando a mesma correção aparecer em vários agentes do mesmo papel.
   */
  recordSuggestion(
    context: TenantContext,
    input: {
      playbookKey: string;
      agentId: string;
      summary: string;
      statement: string;
      facet: string;
    },
  ): Promise<void>;
  /** Sugestões de ofício acumuladas, por playbook. Cross-tenant: pauta da plataforma. */
  listSuggestions(
    playbookKey: string,
    limit: number,
  ): Promise<Array<{ summary: string; statement: string; facet: string; createdAt: Date }>>;
  /** Quantos agentes nasceram de cada playbook. */
  countAgentsByPlaybook(): Promise<Record<string, number>>;
  /** Papéis sem playbook, agrupados por frequência. É a pauta do admin. */
  listMisses(limit: number): Promise<Array<{ role: string; count: number; lastSeen: Date }>>;
}

export interface HubConversationRecord {
  id: string;
  accountId: string;
  userId: string;
  scope: HubScope;
  scopeId: string | null;
  title: string | null;
}

export interface HubMessageRecord {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  attachments: string[];
  createdAt: Date;
}

export interface HubConversationRepository {
  create(
    context: TenantContext,
    input: { id: string; scope: HubScope; scopeId: string | null; title: string | null },
  ): Promise<HubConversationRecord>;

  findById(context: TenantContext, id: string): Promise<HubConversationRecord | null>;

  listMessages(
    context: TenantContext,
    conversationId: string,
    limit: number,
  ): Promise<HubMessageRecord[]>;

  appendMessage(
    context: TenantContext,
    input: {
      id: string;
      conversationId: string;
      role: 'USER' | 'ASSISTANT';
      content: string;
      /** Ids de MediaAsset colados junto da fala. */
      attachments?: string[];
    },
  ): Promise<HubMessageRecord>;
}

export interface HubOperationRepository {
  start(
    context: TenantContext,
    input: {
      id: string;
      conversationId: string;
      operation: string;
      triggeredByMessageId: string;
      policyVersionId: string | null;
      policySections: string[];
    },
  ): Promise<void>;

  finish(
    context: TenantContext,
    input: {
      id: string;
      status: 'COMPLETED' | 'FAILED' | 'AWAITING_CONFIRMATION';
      errorCode?: string;
    },
  ): Promise<void>;

  /** Persistido para permitir replay do SSE após reconexão (§11). */
  appendEvent(
    context: TenantContext,
    input: { id: string; operationId: string; event: HubEvent },
  ): Promise<void>;

  listEvents(context: TenantContext, operationId: string, afterSeq: number): Promise<HubEvent[]>;
}

/** Uma capacidade que falta ao MyAIHub, registrada quando alguém esbarrou nela. */
export interface SystemLimitationRecord {
  id: string;
  accountId: string;
  operation: string;
  summary: string;
  need: string;
  userMessage: string;
  status: 'OPEN' | 'RESOLVED';
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/**
 * A pauta de SUPORTE: o que o S.O não conseguiu fazer por limite do sistema.
 *
 * Grava por conta (quem pediu); lê e resolve na plataforma inteira — por isso
 * `list` e `resolve` rodam em contexto ELEVADO, com motivo e auditoria na rota.
 */
export interface SupportRepository {
  recordLimitation(
    context: TenantContext,
    input: {
      hubOperationId: string | null;
      operation: string;
      summary: string;
      need: string;
      userMessage: string;
    },
  ): Promise<void>;

  listLimitations(
    context: TenantContext,
    filter: { status?: 'OPEN' | 'RESOLVED' },
    limit: number,
  ): Promise<SystemLimitationRecord[]>;

  /** `false` quando não existe. */
  resolveLimitation(context: TenantContext, id: string, note: string): Promise<boolean>;
}
