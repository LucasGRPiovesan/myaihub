import type { CanonicalAgent } from '@myaihub/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

export interface AgentListItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export interface AgentDetail {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  lockVersion: number;
  configuration: {
    versionNumber: number;
    canonical: CanonicalAgent;
    summary: string[];
    createdAt: string;
  } | null;
  /**
   * O ofício de origem e onde ele está hoje.
   *
   * `seenVersion` é até onde ESTE agente já viu. Menor que `currentVersion`
   * significa que o piso do papel evoluiu depois que ele foi projetado — o
   * agente continua funcionando exatamente como está, e a diferença vira uma
   * oferta, nunca uma reescrita silenciosa.
   */
  craft: {
    key: string;
    label: string;
    seenVersion: number;
    currentVersion: number;
  } | null;
}

export interface AgentVersion {
  id: string;
  versionNumber: number;
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: string;
}

export const agentKeys = {
  all: ['agents'] as const,
  detail: (id: string) => ['agents', id] as const,
  versions: (id: string) => ['agents', id, 'versions'] as const,
};

export function useAgents(): UseQueryResult<AgentListItem[]> {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: AgentListItem[] }>('/api/agents');
      return items;
    },
  });
}

export function useAgent(id: string | undefined): UseQueryResult<AgentDetail> {
  return useQuery({
    queryKey: agentKeys.detail(id ?? ''),
    queryFn: () => apiRequest<AgentDetail>(`/api/agents/${id}`),
    enabled: Boolean(id),
  });
}

export function useAgentVersions(id: string | undefined): UseQueryResult<AgentVersion[]> {
  return useQuery({
    queryKey: agentKeys.versions(id ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: AgentVersion[] }>(`/api/agents/${id}/versions`);
      return items;
    },
    enabled: Boolean(id),
  });
}

/**
 * Invalida o cache depois de uma operação do OS.
 *
 * O OS altera agentes por fora do TanStack Query (via SSE); sem isto a tela
 * mostraria o estado anterior à mudança que o usuário acabou de ver acontecer.
 */
export interface DeletionBlocker {
  kind: 'CAMPAIGN' | 'DEPLOYMENT';
  campaignId: string;
  campaignName: string;
  projectId: string;
}

/**
 * O que impede excluir, perguntado ANTES de oferecer o botão.
 *
 * Descobrir o bloqueio depois do "confirmar" é a pior hora de descobrir.
 */
export function useDeletionBlockers(id: string | undefined) {
  return useQuery({
    queryKey: ['agents', id ?? '', 'deletion-blockers'] as const,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: DeletionBlocker[] }>(
        `/api/agents/${id}/deletion-blockers`,
      );
      return items;
    },
    enabled: Boolean(id),
  });
}

export function useDeleteAgent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>(`/api/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export interface AgentTestResult {
  /** A conversa persistida deste teste. Vai de volta no turno seguinte. */
  sessionId: string;
  reply: string;
  violations: Array<{ check: string; message: string; evidence?: string }>;
  /**
   * A checagem semântica rodou neste turno?
   *
   * Lista de violações vazia não significa "passou": pode significar que o
   * validador não respondeu. Sem este campo o Lab mostrava "regras cumpridas"
   * nos dois casos.
   */
  adherence: 'CHECKING' | 'CHECKED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
  /** O turno gravado — é por ele que a tela busca o veredito que chega depois. */
  turnId: string;
  systemPrompt: string;
  /**
   * Trechos do conhecimento do projeto que entraram neste turno.
   *
   * O Lab existe para mostrar isto: sem os trechos, "ele respondeu com base na
   * nossa base" é uma afirmação que ninguém consegue conferir.
   */
  knowledge: Array<{
    sourceId: string;
    revisionId: string;
    title: string;
    excerpt: string;
    score: number;
  }>;
  costMicros: number;
  totalTokens: number;
  /**
   * Efêmeras — extraídas da fala, nunca persistidas. Presente só quando o
   * agente decidiu oferecer (recurso liga/desliga, `engagement.suggestedRepliesEnabled`).
   */
  suggestedReplies?: string[];
}

/**
 * O histórico é DO SERVIDOR (Fase 8).
 *
 * Esta tela guarda o `sessionId`, não o transcrito. Enquanto o histórico vinha
 * daqui, um recarregamento no meio de um teste longo apagava justamente a
 * conversa que o usuário ia mostrar ao OS para pedir o ajuste.
 */
export function useTestAgent(id: string) {
  return useMutation({
    mutationFn: (input: {
      message: string;
      sessionId?: string;
      campaignId?: string;
      projectId?: string;
      /** Sem campanha nem projeto, é o cenário que situa a conversa. */
      scenario?: string;
      /** Efêmera: vira `LlmImagePart` deste turno, nunca é persistida. */
      images?: Array<{ mimeType: string; data: string }>;
    }) => apiRequest<AgentTestResult>(`/api/agents/${id}/test`, { method: 'POST', body: input }),
  });
}

/**
 * Uma conversa persistida, para RETOMAR o teste depois de um recarregamento.
 *
 * Sem isto, persistir no servidor resolveria só metade do problema: a
 * conversa ficaria no banco e a tela voltaria vazia — e é justamente a
 * conversa de teste que o usuário mostra ao OS para pedir o ajuste.
 */
export interface StoredConversation {
  id: string;
  channel: 'PUBLIC' | 'LAB';
  campaignId: string | null;
  projectId: string | null;
  scenario: string | null;
  turns: Array<{
    role: 'VISITOR' | 'AGENT';
    content: string;
    violations: Array<{ check: string; message: string }>;
    createdAt: string;
  }>;
}

export async function fetchConversation(id: string): Promise<StoredConversation> {
  return apiRequest<StoredConversation>(`/api/conversations/${id}`);
}

export function useRefreshAgents(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: agentKeys.all });
  };
}

/** A primeira fala, quando é o agente quem abre a conversa. */
export function useAgentOpening(id: string) {
  return useMutation({
    mutationFn: (
      input: {
        campaignId?: string;
        projectId?: string;
        scenario?: string;
        /** Preenchido ao reiniciar MANTENDO o contexto: aí é retomada. */
        sessionId?: string;
      } = {},
    ) => apiRequest<AgentTestResult>(`/api/agents/${id}/opening`, { method: 'POST', body: input }),
  });
}

export interface BriefingQuestion {
  id: string;
  question: string;
  why: string;
  placeholder: string;
  kind: 'TEXT' | 'CHOICE';
  options?: Array<{ value: string; label: string; hint: string }>;
}

/**
 * As perguntas que precedem a criação do agente.
 *
 * Mutation, e não query: dispara quando o usuário escolhe um papel, não quando
 * a tela monta. Uma query aqui gastaria uma chamada ao modelo só por abrir o
 * painel.
 */
/**
 * Os tipos de agente que o sistema realmente sabe projetar.
 *
 * Vêm dos playbooks cadastrados, não de uma lista fixa: o que aparece na tela
 * passa a ser exatamente o que o OS domina. Cadastrou playbook novo, o tipo
 * aparece; não tem playbook, não promete competência que não existe.
 */
export function useAgentTypes(): UseQueryResult<Array<{ key: string; label: string }>> {
  return useQuery({
    queryKey: ['agents', 'types'] as const,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: Array<{ key: string; label: string }> }>(
        '/api/agents/types',
      );
      return items;
    },
  });
}

export function usePlanBriefing() {
  return useMutation({
    mutationFn: (input: { role: string; playbookKey?: string }) =>
      apiRequest<{
        questions: BriefingQuestion[];
        playbookKey: string | null;
        playbookLabel: string | null;
        costMicros: number;
        totalTokens: number;
      }>('/api/agents/briefing', { method: 'POST', body: input }),
  });
}

/**
 * Põe o agente em dia com o ofício. Sem chamar modelo.
 *
 * Sincronizar não é uma conversa: o texto do playbook foi curado por uma
 * pessoa, e aplicá-lo é mutação tipada. Passando por modelo custava tokens,
 * segundos e precisão — ele parafraseava o princípio curado, e quando lia o
 * pedido como pergunta em vez de ordem não aplicava nada, com a tela dizendo
 * "concluído" sem ter mudado uma linha.
 */
export function useSyncCraft(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiRequest<{ versionNumber: number }>(`/api/agents/${agentId}/sync-craft`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

/**
 * O VEREDITO DA CONFERÊNCIA, buscado DEPOIS da resposta.
 *
 * A auditoria de regras é uma segunda chamada ao provider, e ela segurava a
 * fala do agente na tela — medido no banco, mediana de ~1s do agente contra
 * ~1,1s do auditor: a espera DOBRAVA por um dado acessório sobre uma resposta
 * já produzida e já paga. Travando, cobrava 8s a mais para dizer "indisponível".
 *
 * Agora a fala chega na hora e o selo resolve sozinho. `CHECKING` significa
 * "ainda conferindo" e é o que faz a tela voltar a perguntar; parar de
 * perguntar sem resposta vira "indisponível", nunca o selo verde — não saber
 * não pode virar aprovação.
 */
export interface AdherenceVerdict {
  status: 'CHECKING' | 'CHECKED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
  violations: Array<{ check: string; message: string; evidence?: string }>;
}

export function fetchAdherence(
  sessionId: string,
  turnId: string,
  signal: AbortSignal,
): Promise<AdherenceVerdict> {
  return apiRequest<AdherenceVerdict>(`/api/conversations/${sessionId}/turns/${turnId}/adherence`, {
    signal,
  });
}
