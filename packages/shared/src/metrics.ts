/**
 * Read models do dashboard (§17 Fase 10).
 *
 * Tudo aqui é DERIVADO de `SessionEvent`, `ConversationSession` e `AiCall` —
 * nenhum contador incremental paralelo. Contador que se atualiza sozinho
 * diverge da tabela que ele resume, e aí o dashboard passa a contar uma
 * história que ninguém consegue conferir.
 *
 * O recorte é sempre PUBLIC: o Lab persiste conversa (Fase 8) mas não entra em
 * métrica. Experimento que suja o relatório faz o relatório deixar de servir.
 */

export interface MetricsRange {
  /** ISO. Inclusivo. */
  from: string;
  /** ISO. Exclusivo. */
  to: string;
}

export interface MetricsTotals {
  sessions: number;
  messages: number;
  /** Sessões com mais de um turno do visitante. Uma fala só não é conversa. */
  engagedSessions: number;
  objectivesReached: number;
  violations: number;
  costMicros: number;
  totalTokens: number;
  /** Mediana de falas por sessão. Média esconde a cauda de sessões de 1 turno. */
  medianTurns: number;
}

export interface MetricsSeriesPoint {
  /** YYYY-MM-DD. */
  day: string;
  sessions: number;
  messages: number;
  objectivesReached: number;
  violations: number;
  costMicros: number;
}

export interface CampaignMetricsRow {
  campaignId: string;
  campaignName: string;
  projectId: string;
  projectName: string;
  status: string;
  sessions: number;
  engagedSessions: number;
  objectivesReached: number;
  violations: number;
  costMicros: number;
}

/**
 * Violação agregada por regra.
 *
 * Violação de uma regra explicitamente HARD é falha crítica do MyAIHub, não do
 * usuário (§6.3) — por isso ela aparece por CHECKER, com o número de vezes:
 * é o que transforma "algo saiu errado" em "esta regra falha, e falha aqui".
 */
export interface ViolationRow {
  check: string;
  count: number;
  lastAt: string;
  sampleMessage: string;
}

export interface MetricsOverview {
  range: MetricsRange;
  /**
   * As conversas do recorte passaram do teto de agregação.
   *
   * Existe porque a alternativa é pior: sem teto, um recorte de 90 dias numa
   * conta movimentada carrega tudo em memória para somar, e o custo aparece
   * justamente quando o produto está indo bem. Com teto e SEM este campo, a
   * tela mostraria um número redondo que não é o número — que é a única
   * coisa que um relatório não pode fazer.
   */
  truncated: boolean;
  totals: MetricsTotals;
  series: MetricsSeriesPoint[];
  campaigns: CampaignMetricsRow[];
  violations: ViolationRow[];
}

/** Janelas oferecidas na tela. Fixas: intervalo livre convida a comparar o incomparável. */
export const METRICS_WINDOWS = [7, 30, 90] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

export function formatCostMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(4)}`;
}
