import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/domain/errors.js';
import { StructuredOutputError } from '../domain/provider.js';
import { schemaCorrection } from './llm-gateway.js';

/**
 * A correção de forma é o que salva o turno do usuário.
 *
 * Quando o schema não cabe no teto do provider, a decodificação deixa de ser
 * restrita e o modelo passa a montar a estrutura de cabeça — aí omitir campo
 * obrigatório vira possível. Perder o pedido inteiro por causa disso seria
 * jogar fora o raciocínio que já foi feito e pago.
 */
describe('correção de saída estruturada', () => {
  it('lista os campos exatos que faltaram', () => {
    const error = new AppError('STRUCTURED_OUTPUT_INVALID', 'não bate', {
      details: [
        { path: 'identity', message: 'expected object, received undefined' },
        { path: 'objective', message: 'expected string, received undefined' },
      ],
    });

    const correction = schemaCorrection(error);

    expect(correction).toContain('identity');
    expect(correction).toContain('objective');
    // O modelo não pode recomeçar: ele já decidiu o conteúdo, errou a forma.
    expect(correction).toContain('MESMO conteúdo');
    expect(correction).toContain('Não recomece o raciocínio');
  });

  it('funciona quando nem JSON veio', () => {
    const error = new AppError('STRUCTURED_OUTPUT_INVALID', 'não é JSON', {
      details: { raw: 'Claro! Aqui está...' },
    });

    expect(schemaCorrection(error)).toContain('SOMENTE com o JSON');
  });

  it('NÃO tenta corrigir erro que não é de forma', () => {
    // Repetir uma falha de rede ou de permissão com "corrija os campos" só
    // gastaria uma segunda chamada para receber o mesmo não.
    for (const code of ['PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'RATE_LIMITED'] as const) {
      expect(schemaCorrection(new AppError(code, 'falhou')), code).toBeNull();
    }
    expect(schemaCorrection(new Error('qualquer coisa'))).toBeNull();
  });

  it('não despeja uma lista infinita de problemas no modelo', () => {
    const details = Array.from({ length: 30 }, (_, index) => ({
      path: `campo${index}`,
      message: 'inválido',
    }));

    const correction = schemaCorrection(
      new AppError('STRUCTURED_OUTPUT_INVALID', 'não bate', { details }),
    );

    expect(correction?.split('\n').filter((line) => line.startsWith('  - '))).toHaveLength(8);
  });
});

/**
 * Saída recusada por schema CUSTOU dinheiro.
 *
 * O provider gerou, cobrou e respondeu; quem recusou fomos nós, ao validar.
 * Registrar `in=0 out=0` fazia a chamada mais cara do sistema — uma criação de
 * agente recusada, quase dois minutos e milhares de tokens de saída — entrar no
 * banco como se tivesse sido de graça. E era justamente o turno que o usuário
 * mais sentiu.
 */
describe('custo de uma saída inválida', () => {
  const usage = {
    inputTokens: 9999,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 3987,
    reasoningTokens: 0,
    toolCalls: 0,
    totalTokens: 13_986,
    latencyMs: 105_617,
  };

  it('carrega o uso junto do erro', () => {
    const error = new StructuredOutputError('não bate', usage, [
      { path: 'mutations.1.kind', message: 'Invalid discriminator value' },
    ]);

    expect(error.usage.outputTokens).toBe(3987);
    expect(error.code).toBe('STRUCTURED_OUTPUT_INVALID');
  });

  it('continua produzindo a correção de forma', () => {
    // Carregar o custo não pode custar a correção: são coisas ortogonais, e
    // perder a segunda faria o usuário pagar um turno inteiro de novo.
    const correction = schemaCorrection(
      new StructuredOutputError('não bate', usage, [
        { path: 'identity', message: 'expected object, received undefined' },
      ]),
    );

    expect(correction).toContain('identity');
  });
});
