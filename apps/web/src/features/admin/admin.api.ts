import type { AgentPlaybook } from '@myaihub/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

/**
 * Administração da PLATAFORMA.
 *
 * O que se edita aqui vale para todas as contas — é o ofício que os agentes de
 * todo mundo vão herdar. Por isso as rotas exigem `UserRole.ADMIN`, que é papel
 * de plataforma, não o papel de alguém dentro de uma conta.
 */
// O contrato mora em @myaihub/shared: tipo duplicado nos dois lados diverge, e
// o sintoma é a tela dizer "salvo" enquanto a API devolve 422.
export type {
  AgentPlaybook as Playbook,
  PlaybookFacet,
  PlaybookLimit,
  PlaybookPrinciple,
  PlaybookQuestion,
} from '@myaihub/shared';

export interface PlaybookSummary {
  key: string;
  label: string;
  versionNumber: number;
  updatedAt: string;
  principles: number;
  antiPatterns: number;
  questions: number;
  /** Quantos agentes, na plataforma inteira, nasceram deste ofício. */
  agents: number;
}

/**
 * Correção de OFÍCIO que o OS aplicou num agente deste papel.
 *
 * Já foi entregue a quem pediu. Aqui é evidência: a mesma correção aparecendo
 * em vários agentes é o sinal de que o playbook está incompleto.
 */
export interface PlaybookSuggestion {
  summary: string;
  statement: string;
  facet: string;
  createdAt: string;
}

export interface PlaybookVersionEntry {
  versionNumber: number;
  reason: string;
  createdAt: string;
}

export interface PlaybookMiss {
  role: string;
  count: number;
  lastSeen: string;
}

export const adminKeys = {
  playbooks: ['admin', 'playbooks'] as const,
  playbook: (key: string) => ['admin', 'playbooks', key] as const,
  misses: ['admin', 'playbook-misses'] as const,
  suggestions: (key: string) => ['admin', 'playbooks', key, 'suggestions'] as const,
};

export function usePlaybooks(): UseQueryResult<PlaybookSummary[]> {
  return useQuery({
    queryKey: adminKeys.playbooks,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: PlaybookSummary[] }>('/api/admin/playbooks');
      return items;
    },
  });
}

export function usePlaybook(
  key: string | undefined,
): UseQueryResult<{ playbook: AgentPlaybook; history: PlaybookVersionEntry[] }> {
  return useQuery({
    queryKey: adminKeys.playbook(key ?? ''),
    queryFn: () =>
      apiRequest<{ playbook: AgentPlaybook; history: PlaybookVersionEntry[] }>(
        `/api/admin/playbooks/${key}`,
      ),
    enabled: Boolean(key),
  });
}

/** A pauta de calibração deste ofício, do mais recente para o mais antigo. */
export function usePlaybookSuggestions(
  key: string | undefined,
): UseQueryResult<PlaybookSuggestion[]> {
  return useQuery({
    queryKey: adminKeys.suggestions(key ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: PlaybookSuggestion[] }>(
        `/api/admin/playbooks/${key}/suggestions`,
      );
      return items;
    },
    enabled: Boolean(key),
  });
}

/** Papéis que não casaram com playbook nenhum, por frequência. */
export function usePlaybookMisses(): UseQueryResult<PlaybookMiss[]> {
  return useQuery({
    queryKey: adminKeys.misses,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: PlaybookMiss[] }>('/api/admin/playbook-misses');
      return items;
    },
  });
}

/** Salvar cria VERSÃO NOVA — nunca sobrescreve. */
export function useSavePlaybook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { key: string; playbook: AgentPlaybook; reason: string }) =>
      apiRequest<{ key: string; versionNumber: number }>(`/api/admin/playbooks/${input.key}`, {
        method: 'PUT',
        body: { playbook: input.playbook, reason: input.reason },
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.playbooks });
      void queryClient.invalidateQueries({ queryKey: adminKeys.playbook(input.key) });
    },
  });
}

/**
 * O OS calibra o playbook a pedido, em linguagem natural.
 *
 * PROPÕE, não aplica: um playbook vale para todas as contas, e uma alteração
 * ruim nasceria dentro de todo agente daquele papel antes de alguém perceber.
 * O que volta entra nos campos; a versão só existe quando o admin salva.
 */
export function useRevisePlaybook(key: string) {
  return useMutation({
    mutationFn: (input: { instruction: string }) =>
      apiRequest<{
        playbook: AgentPlaybook;
        summary: string;
        costMicros: number;
        totalTokens: number;
      }>(`/api/admin/playbooks/${key}/revise`, { method: 'POST', body: input }),
  });
}

/**
 * Transforma um documento em rascunho de playbook.
 *
 * NÃO grava: devolve o rascunho para o admin revisar. Ofício é opinião, e uma
 * opinião gerada por modelo entrando direto na plataforma seria o oposto do que
 * o resto do produto faz — a LLM propõe, uma pessoa aprova.
 */
export function useDistillPlaybook() {
  return useMutation({
    mutationFn: (input: { document: string; roleHint?: string; key?: string }) =>
      apiRequest<{ playbook: AgentPlaybook; costMicros: number; totalTokens: number }>(
        '/api/admin/playbooks/distill',
        { method: 'POST', body: input },
      ),
  });
}

/**
 * O OS acabou de versionar um playbook — a tela do admin precisa saber.
 *
 * Correção de ofício gera DUAS versões, uma no agente e uma no piso do papel. A
 * segunda acontecia em silêncio: a listagem continuava mostrando a versão velha
 * até alguém recarregar, e "criei a v6" sem a v6 na tela é indistinguível de
 * não ter criado nada.
 */
export function useRefreshPlaybooks(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
}

/** Um limite do sistema que o S.O encontrou ao atender alguém. */
export interface SystemLimitation {
  id: string;
  accountId: string;
  operation: string;
  summary: string;
  need: string;
  userMessage: string;
  status: 'OPEN' | 'RESOLVED';
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const supportKey = (status: 'OPEN' | 'RESOLVED') => ['admin', 'support', status] as const;

/** A pauta de suporte: o que falta ao MyAIHub, do mais recente para o mais antigo. */
export function useSystemLimitations(
  status: 'OPEN' | 'RESOLVED',
): UseQueryResult<SystemLimitation[]> {
  return useQuery({
    queryKey: supportKey(status),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: SystemLimitation[] }>(
        `/api/admin/support/limitations?status=${status}`,
      );
      return items;
    },
  });
}

/** Marca como resolvido — com o que foi feito, que é o que o próximo vai procurar. */
export function useResolveLimitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; note: string }) =>
      apiRequest<void>(`/api/admin/support/limitations/${input.id}/resolve`, {
        method: 'POST',
        body: { note: input.note },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'support'] });
    },
  });
}
