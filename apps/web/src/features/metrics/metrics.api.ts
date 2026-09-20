import type { MetricsOverview, MetricsWindow } from '@myaihub/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

export const metricsKeys = {
  overview: (days: number, scope: string) => ['metrics', 'overview', days, scope] as const,
};

export function useMetricsOverview(
  days: MetricsWindow,
  filter: { campaignId?: string | undefined; projectId?: string | undefined } = {},
): UseQueryResult<MetricsOverview> {
  const params = new URLSearchParams({ days: String(days) });
  if (filter.campaignId) params.set('campaignId', filter.campaignId);
  if (filter.projectId) params.set('projectId', filter.projectId);

  return useQuery({
    queryKey: metricsKeys.overview(days, params.toString()),
    queryFn: () => apiRequest<MetricsOverview>(`/api/metrics/overview?${params.toString()}`),
    // Métrica não é painel vivo: recarregar a cada foco faria o número dançar
    // enquanto o usuário lê. Um minuto é curto o bastante para não enganar.
    staleTime: 60_000,
  });
}
