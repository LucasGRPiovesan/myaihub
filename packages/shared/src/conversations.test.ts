import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { conversationStatePatchSchema } from './conversations.js';

/**
 * O patch de estado é INFORMAÇÃO ACESSÓRIA, e o schema precisa refletir isso.
 *
 * Ele pega carona na chamada de validação de aderência, que existe para AUDITAR
 * a resposta do agente. Medido no banco: duas saídas recusadas — e com elas o
 * veredito da auditoria — porque o modelo escreveu uma chave com maiúscula e
 * porque omitiu o `note` de dois sinais. Cada recusa pagou um turno de correção
 * por causa da carona.
 *
 * É a mesma regra que o aplicador de mutações já segue: campo que o modelo erra
 * na FORMA não descarta o conteúdo.
 */
describe('patch de estado da conversa', () => {
  it('normaliza a chave do fato em vez de recusar a saída', () => {
    const parsed = conversationStatePatchSchema.parse({
      facts: [{ key: 'Prazo de Entrega', value: 'agosto' }],
      signals: [],
    });

    expect(parsed.facts[0]?.key).toBe('prazo_de_entrega');
  });

  it('tira o acento da chave — o modelo escreve em português', () => {
    const parsed = conversationStatePatchSchema.parse({
      facts: [{ key: 'orçamento', value: 'até 5 mil' }],
      signals: [],
    });

    expect(parsed.facts[0]?.key).toBe('orcamento');
  });

  it('preserva a chave que já vem no formato', () => {
    const parsed = conversationStatePatchSchema.parse({
      facts: [{ key: 'budget.max', value: '5 mil' }],
      signals: [],
    });

    expect(parsed.facts[0]?.key).toBe('budget.max');
  });

  it('DESCARTA o sinal sem `note` e mantém os bons', () => {
    const parsed = conversationStatePatchSchema.parse({
      facts: [],
      signals: [
        { kind: 'URGENCY' },
        { kind: 'OBJECTION', note: 'achou caro' },
        { kind: 'INTEREST', note: '' },
      ],
    });

    // Perder a auditoria inteira por causa de um sinal malformado inverte a
    // prioridade da chamada.
    expect(parsed.signals).toEqual([{ kind: 'OBJECTION', note: 'achou caro' }]);
  });

  it('descarta o fato sem valor', () => {
    const parsed = conversationStatePatchSchema.parse({
      facts: [{ key: 'company' }, { key: 'role', value: 'comprador' }],
      signals: [],
    });

    expect(parsed.facts).toEqual([{ key: 'role', value: 'comprador' }]);
  });

  it('um patch vazio é válido: nem todo turno traz informação nova', () => {
    expect(conversationStatePatchSchema.parse({})).toEqual({ facts: [], signals: [] });
  });

  it('o que NÃO afrouxa: `kind` fora do vocabulário derruba o sinal', () => {
    const parsed = conversationStatePatchSchema.safeParse({
      facts: [],
      signals: [{ kind: 'CURIOSIDADE', note: 'inventado' }],
    });

    // O `kind` chega como string preenchida, então passa pelo descarte — e é o
    // enum que barra. Vocabulário não se adivinha.
    expect(parsed.success).toBe(false);
  });

  /**
   * O schema é convertido para JSON Schema ANTES de qualquer chamada.
   *
   * `.transform()` lança "Transforms cannot be represented in JSON Schema" e
   * mataria toda operação estruturada em 0ms, sem sequer tocar a rede — por
   * isso a normalização usa `z.preprocess`, que sobrevive à conversão.
   */
  it('sobrevive à conversão para JSON Schema', () => {
    expect(() => z.toJSONSchema(conversationStatePatchSchema, { io: 'input' })).not.toThrow();
  });
});
