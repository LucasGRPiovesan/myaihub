import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

export type ManualResource = 'projects' | 'agents' | 'campaigns';

export interface ManualMutationsInput {
  mutations: Array<Record<string, unknown>>;
  reason: string;
}

export interface ManualMutationsResult {
  entityId: string;
  versionNumber: number;
  adjustments: string[];
  rejected: Array<{ kind: string; reason: string }>;
}

/**
 * Edição manual da configuração canônica — o lado barato do painel híbrido.
 *
 * Nenhuma chamada ao modelo: corrigir uma palavra ou digitar a URL de um CTA é
 * decisão que o usuário já tomou. O corpo carrega as MESMAS mutações tipadas
 * que o OS produz, então o domínio valida e versiona igual (§7.2).
 */
export function useManualMutations(resource: ManualResource, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ManualMutationsInput) =>
      apiRequest<ManualMutationsResult>(`/api/${resource}/${id}/mutations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [resource] });
    },
  });
}

/** `semanticKey` a partir de um rótulo digitado à mão. */
export function toSemanticKey(prefix: string, label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  return `${prefix}.${slug || 'item'}`;
}

/**
 * Igual à anterior, com o id vindo na chamada.
 *
 * Existe para o caso em que a entidade ainda NÃO existe quando o componente
 * monta — o agente que está sendo criado neste instante.
 */
export function useApplyMutations(resource: ManualResource) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: ManualMutationsInput & { id: string }) =>
      apiRequest<ManualMutationsResult>(`/api/${resource}/${id}/mutations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [resource] });
    },
  });
}
