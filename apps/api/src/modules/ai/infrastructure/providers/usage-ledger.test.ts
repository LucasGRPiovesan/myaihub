import type { NormalizedUsage } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { UsageLedger } from './usage-ledger.js';

/**
 * O consumo vem do PROVIDER, por tentativa. Nada aqui é estimado.
 *
 * A corrida de pedidos manda até três chamadas e devolve o `usageMetadata` de
 * uma. Contando só a vencedora, o sistema exibia menos do que a fatura vai
 * cobrar — e a saída não é adivinhar o resto, é anotar o que cada tentativa
 * informou enquanto viveu.
 */
function uso(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    inputTokens: 2_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 120,
    reasoningTokens: 0,
    toolCalls: 0,
    totalTokens: 2_120,
    latencyMs: 900,
    ...overrides,
  };
}

describe('razão de consumo', () => {
  it('sem nada anotado, não inventa consumo', () => {
    const razao = new UsageLedger();
    const total = razao.total(500);

    expect(total.totalTokens).toBe(0);
    expect(total.inputTokens).toBe(0);
    expect(razao.reported).toBe(0);
  });

  it('uma tentativa: o total é o que ela reportou', () => {
    const razao = new UsageLedger();
    razao.record(0, uso());

    expect(razao.total(900)).toEqual(uso());
    expect(razao.reported).toBe(1);
  });

  it('o stream é ACUMULADO: a leitura nova substitui a anterior da mesma tentativa', () => {
    // Somar pedaço a pedaço contaria o mesmo token muitas vezes — o
    // `usageMetadata` de cada chunk já inclui os anteriores.
    const razao = new UsageLedger();
    razao.record(0, uso({ outputTokens: 10, totalTokens: 2_010 }));
    razao.record(0, uso({ outputTokens: 60, totalTokens: 2_060 }));
    razao.record(0, uso({ outputTokens: 120, totalTokens: 2_120 }));

    expect(razao.total(900).totalTokens).toBe(2_120);
    expect(razao.reported).toBe(1);
  });

  it('tentativas DIFERENTES somam: foram pedidos diferentes, cobrados cada um', () => {
    const razao = new UsageLedger();
    // A vencedora respondeu inteira; a perdedora só chegou a ler o prompt.
    razao.record(0, uso());
    razao.record(1, uso({ outputTokens: 0, totalTokens: 2_000 }));

    const total = razao.total(900);

    expect(total.inputTokens).toBe(4_000);
    expect(total.outputTokens).toBe(120);
    expect(total.totalTokens).toBe(4_120);
    expect(razao.reported).toBe(2);
  });

  it('a tentativa que nunca reportou nada não entra', () => {
    // É a diferença entre contabilidade e chute: o provider não afirmou que
    // aquele pedido consumiu algo, então o sistema não afirma tampouco.
    const razao = new UsageLedger();
    razao.record(0, uso());

    expect(razao.total(900).inputTokens).toBe(2_000);
  });

  it('a latência é a do TURNO, não a soma das tentativas', () => {
    // Elas correram em paralelo: somar daria um tempo que ninguém esperou.
    const razao = new UsageLedger();
    razao.record(0, uso({ latencyMs: 4_000 }));
    razao.record(1, uso({ latencyMs: 900 }));

    expect(razao.total(4_100).latencyMs).toBe(4_100);
  });
});
