import { METRICS_WINDOWS } from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseQuery } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import type { MetricsRepository } from '../domain/repositories.js';
import type { ExchangeRateProvider } from '../../usage/domain/exchange-rate.js';
import type { AiCallReadRepository } from '../../usage/domain/repositories.js';

export interface MetricsRouterDependencies {
  tokens: TokenService;
  metrics: MetricsRepository;
  /** O acumulado de chamadas ao modelo, para o custo do mês. */
  usage: AiCallReadRepository;
  exchangeRate: ExchangeRateProvider;
  /** Qual cota do provider está servindo. Ausente quando o provider não tem duas. */
  quotaStatus?: () => {
    tier: 'FREE' | 'PAID';
    freeAvailableAt: Date | null;
    hasPaidKey: boolean;
  } | null;
}

/**
 * O dashboard (§17 Fase 10).
 *
 * A janela é FIXA — 7, 30 ou 90 dias — e não um intervalo livre. Intervalo
 * livre convida a comparar o incomparável (uma semana com um mês) e produz
 * números que parecem contraditórios entre duas telas abertas lado a lado.
 *
 * O corte é sempre em UTC, do início do dia. Cortar "agora menos 7 dias"
 * moveria a fronteira a cada recarregamento, e o gráfico mudaria sem que nada
 * tivesse acontecido.
 */
export function createMetricsRouter(deps: MetricsRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.get('/metrics/overview', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const query = parseQuery(
      z.object({
        days: z.coerce
          .number()
          .int()
          .refine((value) => (METRICS_WINDOWS as readonly number[]).includes(value), {
            message: 'Janela inválida. Use 7, 30 ou 90 dias.',
          })
          .default(30),
        campaignId: z.string().length(26).optional(),
        projectId: z.string().length(26).optional(),
      }),
      request,
    );

    const to = new Date();
    to.setUTCHours(0, 0, 0, 0);
    to.setUTCDate(to.getUTCDate() + 1);

    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - query.days);

    response.json(
      await deps.metrics.overview(
        tenant,
        { from: from.toISOString(), to: to.toISOString() },
        {
          ...(query.campaignId ? { campaignId: query.campaignId } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
        },
      ),
    );
  });

  /**
   * QUANTO ESTÁ SENDO GASTO — o número que o painel mostra no cabeçalho.
   *
   * O custo por turno já aparecia sob cada operação, mas o usuário não tinha
   * onde ver o acumulado: ele lia "US$ 0,0026" doze vezes e não sabia dizer se
   * tinha gasto dez centavos ou dez reais. Custo que só aparece na fatura não é
   * informação, é surpresa — a mesma razão pela qual o valor do turno existe.
   *
   * A janela é o MÊS corrente, em UTC, porque é assim que a conta do provider
   * fecha; "desde sempre" cresceria para um número que não se compara com nada.
   *
   * A COTAÇÃO viaja junto, com a data e a fonte. O custo continua gravado em
   * dólar — converter na gravação congelaria uma cotação dentro do histórico —,
   * e a conversão acontece aqui, na leitura, com o valor de hoje.
   */
  router.get('/metrics/spend', auth, async (request, response) => {
    const tenant = requireTenant(request);

    const inicioDoMes = new Date();
    inicioDoMes.setUTCHours(0, 0, 0, 0);
    inicioDoMes.setUTCDate(1);

    const [resumo, ultima] = await Promise.all([
      deps.usage.summarizeForAccount(tenant.accountId, inicioDoMes),
      deps.usage.lastServedTier(tenant.accountId),
    ]);
    const rate = deps.exchangeRate.current();

    response.json({
      month: {
        from: inicioDoMes.toISOString(),
        costMicros: resumo.totalCostMicros,
        totalTokens: resumo.totalTokens,
        calls: resumo.totalCalls,
      },
      rate,
      /**
       * QUAL COTA serviu — o que ACONTECEU, não o que o adapter tentaria agora.
       *
       * A primeira versão devolvia o estado em memória do provider, e ele é
       * PREVISÃO: reinicia junto do processo. Depois de um restart o adapter
       * volta a supor que a cota gratuita está de pé, e a Topbar dizia "cota
       * gratuita" enquanto as chamadas saíam pela paga — medido, e é
       * exatamente o tipo de número que este sistema passou a sessão inteira
       * corrigindo.
       *
       * `tier` agora vem de `ai_calls`: é o que serviu a última chamada. A
       * previsão continua junto, em `next`, porque é ela que explica a trava
       * do seletor de modelo e o horário em que a gratuita volta — mas quem
       * responde "estou pagando?" é o fato.
       */
      ...(ultima || deps.quotaStatus
        ? {
            quota: {
              ...(ultima ? { tier: ultima.tier, at: ultima.at.toISOString() } : {}),
              ...(deps.quotaStatus ? { next: deps.quotaStatus() } : {}),
            },
          }
        : {}),
    });
  });

  return router;
}
