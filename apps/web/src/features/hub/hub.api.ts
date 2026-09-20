import {
  HUB_SSE_EVENT,
  type HubConversationView,
  type HubEvent,
  type HubOperationView,
  type HubScope,
} from '@myaihub/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { apiRequest } from '../../lib/api-client';

export interface StartConversationInput {
  scope: HubScope;
  scopeId?: string;
}

export function useStartConversation() {
  return useMutation({
    mutationFn: (input: StartConversationInput) =>
      apiRequest<HubConversationView>('/api/hub/conversations', {
        method: 'POST',
        body: input,
      }),
  });
}

export function useSendHubMessage() {
  return useMutation({
    mutationFn: (input: {
      conversationId: string;
      content: string;
      operation?: string;
      operationPicked?: boolean;
      attachmentIds?: string[];
      playbookKey?: string;
      /** A conversa de teste em andamento, quando o escopo é de um agente. */
      testTranscript?: Array<{ role: 'user' | 'assistant'; content: string }>;
      /** "Atualizar pelo ofício": reaplica o piso do playbook sobre o agente. */
      syncCraft?: boolean;
    }) =>
      apiRequest<{ operation: HubOperationView }>(
        `/api/hub/conversations/${input.conversationId}/messages`,
        {
          method: 'POST',
          body: {
            content: input.content,
            ...(input.operation ? { operation: input.operation } : {}),
            ...(input.operationPicked ? { operationPicked: true } : {}),
            ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
            ...(input.playbookKey ? { playbookKey: input.playbookKey } : {}),
            ...(input.testTranscript?.length ? { testTranscript: input.testTranscript } : {}),
            ...(input.syncCraft ? { syncCraft: true } : {}),
          },
        },
      ),
  });
}

/**
 * Acompanha os eventos de uma operação por SSE.
 *
 * `EventSource` não aceita cabeçalhos, então a autenticação depende do cookie
 * httpOnly — que é justamente por isso que a sessão vive em cookie e não só em
 * `Authorization`. `withCredentials` garante que ele seja enviado.
 *
 * Reconexão é automática no `EventSource`, e o browser reenvia `Last-Event-ID`;
 * o servidor faz o replay a partir dali.
 */
export function useHubOperationStream(
  operationId: string | null,
  onEvent: (event: HubEvent) => void,
): void {
  // Guardar o callback numa ref evita reabrir a conexão a cada render do pai —
  // reabrir o SSE no meio de uma operação perderia os eventos do intervalo.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!operationId) return;

    const source = new EventSource(`/api/hub/operations/${operationId}/events`, {
      withCredentials: true,
    });

    const listener = (message: MessageEvent<string>): void => {
      try {
        handler.current(JSON.parse(message.data) as HubEvent);
      } catch {
        // Evento malformado não pode derrubar o stream inteiro.
      }
    };

    source.addEventListener(HUB_SSE_EVENT, listener as EventListener);

    return () => {
      source.removeEventListener(HUB_SSE_EVENT, listener as EventListener);
      source.close();
    };
  }, [operationId]);
}

export function useHubConversation(
  conversationId: string | null,
): () => Promise<HubConversationView | null> {
  return useCallback(async () => {
    if (!conversationId) return null;
    return apiRequest<HubConversationView>(`/api/hub/conversations/${conversationId}`);
  }, [conversationId]);
}
