import type { NormalizedUsage } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { calculateCost, formatMicros, type PricingRecord } from './pricing.js';

const FLASH_LITE: PricingRecord = {
  id: '01PRICING000000000000000A',
  provider: 'gemini',
  model: 'gemini-2.5-flash-lite',
  inputMicros: 100_000n, // US$ 0,10 / 1M
  cachedInputMicros: 25_000n, // US$ 0,025 / 1M
  cacheWriteMicros: 0n,
  outputMicros: 400_000n, // US$ 0,40 / 1M
  reasoningMicros: 0n,
  currency: 'USD',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  sourceLabel: 'teste',
};

function usage(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    toolCalls: 0,
    totalTokens: 0,
    latencyMs: 10,
    ...overrides,
  };
}

describe('calculateCost', () => {
  it('cobra input e output pelas tarifas correspondentes', () => {
    const cost = calculateCost(
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      FLASH_LITE,
    );

    expect(cost.inputMicros).toBe(100_000);
    expect(cost.outputMicros).toBe(400_000);
    expect(cost.totalMicros).toBe(500_000); // US$ 0,50
  });

  it('não cobra o input cacheado duas vezes', () => {
    // Os providers reportam inputTokens JÁ incluindo o cacheado. Cobrar os dois
    // pela tarifa cheia inflaria o custo silenciosamente.
    const cost = calculateCost(
      usage({ inputTokens: 1_000_000, cachedInputTokens: 800_000 }),
      FLASH_LITE,
    );

    // 200k na tarifa cheia (20.000) + 800k na de cache (20.000)
    expect(cost.inputMicros).toBe(40_000);
  });

  it('cobra raciocínio como saída quando não há tarifa específica', () => {
    const cost = calculateCost(usage({ reasoningTokens: 1_000_000 }), FLASH_LITE);
    expect(cost.outputMicros).toBe(400_000);
  });

  it('usa a tarifa de raciocínio quando ela existe', () => {
    const cost = calculateCost(usage({ reasoningTokens: 1_000_000 }), {
      ...FLASH_LITE,
      reasoningMicros: 1_000_000n,
    });

    expect(cost.outputMicros).toBe(1_000_000);
  });

  it('devolve zero para uso vazio', () => {
    expect(calculateCost(usage(), FLASH_LITE).totalMicros).toBe(0);
  });

  it('não produz custo negativo quando o cache excede o input reportado', () => {
    const cost = calculateCost(usage({ inputTokens: 100, cachedInputTokens: 500 }), FLASH_LITE);

    expect(cost.inputMicros).toBeGreaterThanOrEqual(0);
  });

  it('mantém precisão somando milhares de chamadas pequenas', () => {
    // O motivo de usar inteiros: em float, 10.000 somas de valores minúsculos
    // acumulam erro até o total não bater com a fatura.
    const single = calculateCost(usage({ inputTokens: 1_337, outputTokens: 421 }), FLASH_LITE);
    const total = Array.from({ length: 10_000 }).reduce<number>(
      (sum) => sum + single.totalMicros,
      0,
    );

    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(single.totalMicros * 10_000);
  });

  it('preserva a moeda da linha de preço', () => {
    expect(calculateCost(usage({ inputTokens: 10 }), FLASH_LITE).currency).toBe('USD');
  });
});

describe('formatMicros', () => {
  it('formata micros como dólares', () => {
    expect(formatMicros(500_000)).toBe('US$ 0.500000');
    expect(formatMicros(0)).toBe('US$ 0.000000');
  });
});
