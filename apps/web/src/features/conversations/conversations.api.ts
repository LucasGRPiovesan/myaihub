import type { ConversationChannel, ConversationTurnView } from '@myaihub/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

/**
 * As conversas persistidas (Fase 8), para LER.
 *
 * Elas existem desde que a Fase 8 entrou, e até agora ninguém conseguia
 * abri-las: o dashboard mostrava quantas conversas houve, quanto custaram e
 * quantas regras falharam, sem um caminho para ver o que foi dito. Número sem
 * o caso por trás não deixa ninguém corrigir nada — que é o motivo de medir.
 */

export interface ConversationListItem {
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

export interface ConversationDetail extends ConversationListItem {
  turns: ConversationTurnView[];
  state: {
    facts: Array<{ key: string; value: string }>;
    signals: Array<{ kind: string; note: string }>;
    progress: { percent: number; objectiveReached: boolean };
  };
}

export const conversationKeys = {
  list: (scope: string) => ['conversations', scope] as const,
  detail: (id: string) => ['conversations', 'detail', id] as const,
};

export function useConversations(filter: {
  channel?: ConversationChannel;
  campaignId?: string | undefined;
  agentId?: string | undefined;
}): UseQueryResult<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (filter.channel) params.set('channel', filter.channel);
  if (filter.campaignId) params.set('campaignId', filter.campaignId);
  if (filter.agentId) params.set('agentId', filter.agentId);

  return useQuery({
    queryKey: conversationKeys.list(params.toString()),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: ConversationListItem[] }>(
        `/api/conversations?${params.toString()}`,
      );
      return items;
    },
  });
}

export function useConversation(id: string | null): UseQueryResult<ConversationDetail> {
  return useQuery({
    queryKey: conversationKeys.detail(id ?? ''),
    queryFn: () => apiRequest<ConversationDetail>(`/api/conversations/${id}`),
    enabled: Boolean(id),
  });
}
