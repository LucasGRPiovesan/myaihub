import { describe, expect, it } from 'vitest';
import { normalizeError } from './error-handler.js';

/**
 * Schema ausente é setup pendente, não bug.
 *
 * Aconteceu de verdade: o container do MySQL foi recriado com a API já no ar, o
 * `assertSchemaApplied` do boot não pegou (ele já tinha passado), e o login
 * passou a responder "Erro interno". A pessoa vai procurar bug no código pelo
 * tempo que levar até desconfiar do banco.
 */
describe('erro de schema ausente', () => {
  it('P2021 vira mensagem acionável, não "Erro interno"', () => {
    const normalized = normalizeError(
      Object.assign(new Error('The table `users` does not exist'), { code: 'P2021' }),
    );

    expect(normalized.message).toContain('db:migrate:deploy');
    expect(normalized.message).toContain('db:seed');
    // 503, não 500: o serviço está indisponível por configuração, não quebrado.
    expect(normalized.httpStatus).toBe(503);
    // Não é inesperado: sabemos exatamente o que é.
    expect(normalized.unexpected).toBe(false);
  });

  it('P2022 (coluna ausente) recebe o mesmo tratamento', () => {
    const normalized = normalizeError(Object.assign(new Error('column'), { code: 'P2022' }));
    expect(normalized.httpStatus).toBe(503);
  });

  it('outro erro do Prisma continua sendo erro interno', () => {
    // P2002 é violação de unicidade — isso é bug ou concorrência, não setup.
    const normalized = normalizeError(Object.assign(new Error('unique'), { code: 'P2002' }));
    expect(normalized.message).toBe('Erro interno.');
    expect(normalized.httpStatus).toBe(500);
    expect(normalized.unexpected).toBe(true);
  });

  it('erro comum continua sendo erro interno', () => {
    expect(normalizeError(new Error('qualquer coisa')).httpStatus).toBe(500);
  });
});
