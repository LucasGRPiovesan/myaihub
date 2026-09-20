import type { ModelRole, ProviderCatalogEntry, ProviderName } from '@myaihub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

export interface ModelRouteView {
  role: ModelRole;
  label: string;
  note: string;
  /** O que o admin escolheu (ou o padrão da env, quando ninguém escolheu). */
  selected: { provider: ProviderName; model: string };
  /** O que vai ser usado de fato. Difere do escolhido sob a trava da cota. */
  effective: { provider: ProviderName; model: string };
  source: 'ADMIN' | 'ENV';
}

export interface ModelSettings {
  providers: Array<ProviderCatalogEntry & { available: boolean }>;
  roles: ModelRouteView[];
  lockedToFreeTier: boolean;
}

const modelsKey = ['admin', 'models'] as const;

/**
 * A configuração de modelos — só o ADMIN da plataforma recebe 200 aqui.
 *
 * `enabled` decide se a pergunta chega a ser feita: para o usuário comum a rota
 * responde 403, e disparar uma requisição que já se sabe que será negada
 * encheria o console dele de erro por uma tela que ele nem vê.
 */
export function useModelSettings(enabled: boolean) {
  return useQuery({
    queryKey: modelsKey,
    queryFn: () => apiRequest<ModelSettings>('/api/admin/models'),
    enabled,
    staleTime: 60_000,
  });
}

export function useSetModelRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { role: ModelRole; provider: ProviderName; model: string }) =>
      apiRequest<unknown>(`/api/admin/models/${input.role}`, {
        method: 'PUT',
        body: { provider: input.provider, model: input.model },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modelsKey });
    },
  });
}
