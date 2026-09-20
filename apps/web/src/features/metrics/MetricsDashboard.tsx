import {
  formatCostMicros,
  METRICS_WINDOWS,
  type MetricsOverview,
  type MetricsSeriesPoint,
  type MetricsWindow,
} from '@myaihub/shared';
import { useState } from 'react';
import { SkeletonText } from '../../design-system/feedback';
import { Card, cx } from '../../design-system/primitives';
import { ConversationsPanel } from '../conversations/ConversationsPanel';
import { useMetricsOverview } from './metrics.api';

/**
 * O dashboard (§17 Fase 10).
 *
 * Um componente, três lugares: raiz, projeto e campanha. O que muda é o
 * filtro — e três dashboards diferentes significariam três definições de
 * "conversa engajada", com o usuário descobrindo a divergência ao comparar
 * duas telas abertas lado a lado.
 *
 * Só conversa PÚBLICA entra. O Lab persiste (Fase 8) e fica de fora: são
 * dezenas de turnos de teste por dia, e misturá-los faria o número subir
 * sempre que alguém estivesse trabalhando.
 */

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <Card className="p-4">
      <p className="text-[12px] tracking-tight text-text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-text-muted">{hint}</p>}
    </Card>
  );
}

/**
 * Gráfico de barras em CSS puro.
 *
 * Sem biblioteca: são trinta barras de uma série só, e uma dependência de
 * gráficos custaria mais bytes que a tela inteira para desenhar o que um
 * `height` resolve. Quando houver eixo, tooltip e séries sobrepostas, aí sim.
 */
function Series({ points }: { points: MetricsSeriesPoint[] }) {
  const maximo = Math.max(1, ...points.map((point) => point.sessions));

  return (
    <div className="mt-3 flex h-32 items-end gap-[3px]" aria-hidden>
      {points.map((point) => (
        <div
          key={point.day}
          title={`${point.day}: ${point.sessions} conversa(s)`}
          className="min-w-0 flex-1 rounded-t-[2px] bg-accent/70"
          style={{ height: `${Math.max(2, (point.sessions / maximo) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Conteudo({ data }: { data: MetricsOverview }) {
  const { totals } = data;

  // Taxa sobre ENGAJADAS, não sobre conversas: quem abriu e fechou sem dizer
  // nada não teve chance de converter, e contá-la no denominador afunda a taxa
  // com um número que não fala sobre o agente.
  const conversao =
    totals.engagedSessions > 0
      ? `${Math.round((totals.objectivesReached / totals.engagedSessions) * 100)}%`
      : '—';

  return (
    <>
      {/* Amostra é amostra, e a tela diz isso. Um relatório que apresenta
          parte como se fosse o todo é pior que um relatório que falta. */}
      {data.truncated && (
        <Card className="mb-3 p-4">
          <p className="text-[13px] leading-relaxed text-text-muted">
            Este recorte tem mais conversas do que cabe numa agregação só. Os números abaixo cobrem
            as mais recentes — escolha uma janela menor para ver o total.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Conversas"
          value={String(totals.sessions)}
          hint={`${totals.engagedSessions} passaram do primeiro turno`}
        />
        <Metric
          label="Objetivo alcançado"
          value={String(totals.objectivesReached)}
          hint={`${conversao} das conversas engajadas`}
        />
        <Metric
          label="Custo"
          value={formatCostMicros(totals.costMicros)}
          hint={`${totals.totalTokens.toLocaleString('pt-BR')} tokens`}
        />
        <Metric
          label="Violações de regra"
          value={String(totals.violations)}
          hint={totals.violations > 0 ? 'falha nossa, não do usuário' : 'nenhuma'}
        />
      </div>

      <Card className="mt-4 p-5">
        <p className="text-[13px] font-medium text-text">Conversas por dia</p>
        <Series points={data.series} />
        <p className="mt-2 text-[12px] text-text-subtle">
          Mediana de {totals.medianTurns} falas por conversa.
        </p>
      </Card>

      {data.campaigns.length > 0 && (
        <Card className="mt-4 p-5">
          <p className="text-[13px] font-medium text-text">Por campanha</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="text-text-subtle">
                <tr>
                  <th className="pb-2 font-normal">Campanha</th>
                  <th className="pb-2 text-right font-normal">Conversas</th>
                  <th className="pb-2 text-right font-normal">Engajadas</th>
                  <th className="pb-2 text-right font-normal">Objetivo</th>
                  <th className="pb-2 text-right font-normal">Custo</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((row) => (
                  <tr key={row.campaignId} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <span className="text-text">{row.campaignName}</span>
                      <span className="ml-2 text-text-subtle">{row.projectName}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-text">{row.sessions}</td>
                    <td className="py-2 text-right tabular-nums text-text-muted">
                      {row.engagedSessions}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-muted">
                      {row.objectivesReached}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-muted">
                      {formatCostMicros(row.costMicros)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.violations.length > 0 && (
        <Card className="mt-4 p-5">
          <p className="text-[13px] font-medium text-text">Regras que falharam</p>
          <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
            Violar uma regra marcada como obrigatória é falha do MyAIHub, não configuração ruim.
            Cada linha aqui é uma regra que não está pegando.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {data.violations.map((violation) => (
              <li key={violation.check} className="border-t border-border pt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12px] text-text">{violation.check}</span>
                  <span className="tabular-nums text-[13px] text-text-muted">
                    {violation.count}×
                  </span>
                </div>
                {violation.sampleMessage && (
                  <p className="mt-0.5 text-[12px] text-text-muted">{violation.sampleMessage}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function MetricsDashboard({
  campaignId,
  projectId,
}: {
  campaignId?: string | undefined;
  projectId?: string | undefined;
}) {
  const [days, setDays] = useState<MetricsWindow>(30);
  const { data, isPending, isError } = useMetricsOverview(days, { campaignId, projectId });

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {METRICS_WINDOWS.map((janela) => (
          <button
            key={janela}
            type="button"
            onClick={() => setDays(janela)}
            className={cx(
              'rounded-[var(--radius-control)] border px-3 py-1 text-[13px]',
              days === janela
                ? 'border-border-strong bg-surface-sunken text-text'
                : 'border-border text-text-muted',
            )}
          >
            {janela} dias
          </button>
        ))}
      </div>

      <div className="mt-4">
        {isPending && <SkeletonText lines={4} />}

        {isError && (
          <Card className="p-6">
            <p role="alert" className="text-sm text-danger">
              Não foi possível carregar as métricas.
            </p>
          </Card>
        )}

        {data && data.totals.sessions === 0 && (
          <Card className="p-6">
            <p className="text-sm leading-relaxed text-text-muted">
              Nenhuma conversa pública nesta janela. As conversas do laboratório não entram aqui de
              propósito — elas somem no meio do que interessa, que é o que aconteceu com gente de
              verdade.
            </p>
          </Card>
        )}

        {data && data.totals.sessions > 0 && <Conteudo data={data} />}

        {/* As conversas por trás dos números. Um relatório que diz "3 violações"
            sem deixar ler os três casos não permite corrigir nada — e corrigir é
            o motivo de medir. */}
        <ConversationsPanel campaignId={campaignId} />
      </div>
    </div>
  );
}
