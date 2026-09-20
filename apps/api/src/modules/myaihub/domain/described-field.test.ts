import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { describedField } from './output-intent.js';
import { listOperations } from './operation.js';

/**
 * Campo descritivo não derruba a saída — e o schema continua conversível.
 *
 * Aconteceu em produção: o modelo escreveu um `interpretedIntent` um pouco mais
 * longo que o teto e a operação inteira foi recusada, duas vezes seguidas, com
 * o usuário esperando por uma legenda que nem governa comportamento.
 */
describe('campo descritivo', () => {
  const campo = describedField(300);

  it('corta o que passa do limite em vez de recusar', () => {
    const longo = 'a'.repeat(420);
    const parsed = campo.safeParse(longo);

    expect(parsed.success).toBe(true);
    expect((parsed.data as string).length).toBe(300);
  });

  it('continua recusando o que é vazio demais para significar algo', () => {
    expect(campo.safeParse('ab').success).toBe(false);
  });

  it('sobrevive à conversão para JSON Schema', () => {
    // `.transform()` lançaria aqui — e o schema é convertido ANTES de qualquer
    // chamada, então isso derrubaria toda operação estruturada em 0ms.
    expect(() =>
      z.toJSONSchema(z.object({ interpretedIntent: campo }), { io: 'input' }),
    ).not.toThrow();
  });

  it('toda operação do catálogo aceita um interpretedIntent longo', () => {
    const longo = 'x'.repeat(400);
    const recusadas: string[] = [];

    for (const operation of listOperations()) {
      const schema = operation.outputSchema as z.ZodType<unknown> | undefined;
      if (!schema) continue;

      const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
      const campoDaOperacao = shape?.['interpretedIntent'];
      if (!campoDaOperacao) continue;

      if (!campoDaOperacao.safeParse(longo).success) recusadas.push(operation.name);
    }

    expect(recusadas).toEqual([]);
  });
});
