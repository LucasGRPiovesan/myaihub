import type { MetricsOverview, MetricsRange } from '@myaihub/shared';
import type { TenantContext } from '../../../shared/application/tenant-context.js';

/**
 * Read models do dashboard (§17 Fase 10).
 *
 * Uma porta só, com uma consulta só: o dashboard responde a UMA pergunta —
 * "as conversas estão indo bem?" — e quebrar isso em cinco chamadas produziria
 * cinco recortes de tempo que podem divergir entre si na tela.
 *
 * Tudo é DERIVADO de `SessionEvent`, `ConversationSession` e `AiCall`. Nenhum
 * contador incremental paralelo: contador que se atualiza sozinho diverge da
 * tabela que ele resume, e aí o número deixa de ser conferível.
 */
export interface MetricsRepository {
  overview(
    context: TenantContext,
    range: MetricsRange,
    filter: { campaignId?: string; projectId?: string },
  ): Promise<MetricsOverview>;
}
