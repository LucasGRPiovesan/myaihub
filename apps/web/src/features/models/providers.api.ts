import type { ProviderKeyKind, ProviderName } from '@myaihub/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

/**
 * Gestão de PROVEDORES — chave e liga/desliga. Só ADMIN da plataforma.
 *
 * A chave em si NUNCA chega aqui: a API devolve só os últimos 4 caracteres
 * (`masked`), o suficiente para o admin reconhecer QUAL chave está cadastrada
 * sem que o valor completo passe pela rede uma segunda vez.
 */

export interface ProviderKeySlot {
  kind: ProviderKeyKind;
  label: string;
  configured: boolean;
  masked: string | null;
  updatedAt: string | null;
}

export interface ProviderStatus {
  provider: ProviderName;
  enabled: boolean;
  /** O que está DE FATO valendo — pode ser `false` mesmo com chave cadastrada. */
  available: boolean;
  keys: ProviderKeySlot[];
  /**
   * Só o Gemini distingue gratuita de paga — os três campos vêm AUSENTES
   * para os demais, e é assim que a tela sabe que não há Switch para
   * desenhar ali.
   */
  forcedPaid?: boolean;
  /** O que a PRÓXIMA chamada vai usar — estado VIVO do anel, não histórico. */
  tier?: 'FREE' | 'PAID';
  /** `null` = a gratuita está livre agora (forçada ou não). */
  freeAvailableAt?: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

const providersKey = ['admin', 'providers'] as const;

/**
 * `enabled: false` para quem não é admin — a rota é `requireRole('ADMIN')` e
 * chamá-la de qualquer jeito só produziria um 403 a cada render do badge.
 */
export function useProviders(options?: { enabled?: boolean }): UseQueryResult<ProviderStatus[]> {
  return useQuery({
    queryKey: providersKey,
    queryFn: async () => {
      const { providers } = await apiRequest<{ providers: ProviderStatus[] }>('/api/admin/providers');
      return providers;
    },
    enabled: options?.enabled ?? true,
  });
}

export function useSetProviderEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { provider: ProviderName; enabled: boolean }) =>
      apiRequest<void>(`/api/admin/providers/${input.provider}`, {
        method: 'PATCH',
        body: { enabled: input.enabled },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providersKey });
    },
  });
}

export function useSaveProviderKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { provider: ProviderName; kind: ProviderKeyKind; apiKey: string }) =>
      apiRequest<void>(`/api/admin/providers/${input.provider}/keys/${input.kind}`, {
        method: 'PUT',
        body: { apiKey: input.apiKey },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providersKey });
    },
  });
}

/**
 * A ESCOLHA do admin: usar a chave paga do Gemini mesmo com a gratuita de pé.
 * Não é o mesmo caso de `useSetProviderEnabled` — não muda chave nenhuma, é
 * uma preferência de runtime, aplicada direto na instância viva do servidor.
 */
export function useSetGeminiForcedPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { forcedPaid: boolean }) =>
      apiRequest<void>('/api/admin/providers/gemini/force-paid', {
        method: 'PATCH',
        body: { forcedPaid: input.forcedPaid },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providersKey });
    },
  });
}

/**
 * Testa a conexão — a chave do formulário (`apiKey`), ou a já salva quando
 * omitida. Nunca grava nada: só responde "isto funciona?".
 */
export function useTestProviderKey() {
  return useMutation({
    mutationFn: (input: { provider: ProviderName; kind: ProviderKeyKind; apiKey?: string }) =>
      apiRequest<ConnectionTestResult>(
        `/api/admin/providers/${input.provider}/keys/${input.kind}/test`,
        { method: 'POST', body: { ...(input.apiKey ? { apiKey: input.apiKey } : {}) } },
      ),
  });
}
