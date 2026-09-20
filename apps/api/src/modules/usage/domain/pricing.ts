import type { CalculatedCost, NormalizedUsage, ProviderName } from '@myaihub/shared';

/**
 * Linha de preço aplicada a uma chamada.
 *
 * Valores em MICROS de USD por 1.000.000 de tokens, em inteiro. Preço de LLM
 * tem muitas casas decimais e é somado milhares de vezes — em ponto flutuante,
 * o erro acumula até o total não fechar com a fatura.
 */
export interface PricingRecord {
  id: string;
  provider: ProviderName;
  model: string;
  inputMicros: bigint;
  cachedInputMicros: bigint;
  cacheWriteMicros: bigint;
  outputMicros: bigint;
  reasoningMicros: bigint;
  currency: 'USD';
  effectiveFrom: Date;
  sourceLabel: string;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000n;

function costFor(tokens: number, microsPerMillion: bigint): bigint {
  if (tokens <= 0 || microsPerMillion === 0n) return 0n;
  return (BigInt(Math.round(tokens)) * microsPerMillion) / TOKENS_PER_PRICE_UNIT;
}

/**
 * CostEngine (§38).
 *
 * Calcula com o preço vigente NO MOMENTO da chamada. Quem persiste guarda o
 * snapshot da linha usada — histórico jamais é recalculado com preço novo.
 */
export function calculateCost(usage: NormalizedUsage, pricing: PricingRecord): CalculatedCost {
  // O input cacheado é cobrado à parte e NÃO deve ser cobrado de novo na
  // tarifa cheia: os providers reportam o total de input já incluindo o cacheado.
  const billableInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);

  const inputMicros =
    costFor(billableInput, pricing.inputMicros) +
    costFor(usage.cachedInputTokens, pricing.cachedInputMicros) +
    costFor(usage.cacheWriteTokens, pricing.cacheWriteMicros);

  // Quando não há preço específico de raciocínio, ele é cobrado como saída —
  // que é o modelo de cobrança dos providers atuais.
  const reasoningRate =
    pricing.reasoningMicros > 0n ? pricing.reasoningMicros : pricing.outputMicros;

  const outputMicros =
    costFor(usage.outputTokens, pricing.outputMicros) +
    costFor(usage.reasoningTokens, reasoningRate);

  return {
    inputMicros: Number(inputMicros),
    outputMicros: Number(outputMicros),
    totalMicros: Number(inputMicros + outputMicros),
    currency: pricing.currency,
  };
}

/** Custo zero, para quando não há preço cadastrado (ex.: FakeProvider). */
export const ZERO_COST: CalculatedCost = {
  inputMicros: 0,
  outputMicros: 0,
  totalMicros: 0,
  currency: 'USD',
};

/** Formata micros de USD para leitura humana. */
export function formatMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(6)}`;
}
