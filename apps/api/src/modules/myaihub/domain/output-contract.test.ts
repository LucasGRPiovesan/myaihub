import { describe, expect, it } from 'vitest';
import { listOperations } from './operation.js';

/**
 * O contrato de saída existe em TODA operação estruturada.
 *
 * Ele morava no fim da instrução e funcionava enquanto a instrução era o último
 * bloco. Deixou de ser quando playbook e canônico passaram a entrar depois
 * dela, e o sintoma foi o modelo omitindo os campos curtos e obrigatórios
 * depois da geração inteira já paga. Como bloco próprio de prioridade mínima
 * ele fica no fim independente de quantos blocos alguém acrescente — mas só
 * onde alguém o escreveu, e é isso que este teste cobra.
 */
describe('contrato de saída', () => {
  const operations = listOperations();

  it('cobre todas as operações do catálogo', () => {
    const semContrato = operations.filter((op) => !op.outputContract).map((op) => op.name);
    expect(semContrato).toEqual([]);
  });

  it.each(operations.map((op) => [op.name, op] as const))(
    '%s lembra o contrato no FIM, não no meio',
    (_name, operation) => {
      // "ANTES DE RESPONDER" é a deixa: o que vem por último é o que o modelo
      // retém. Um contrato que não se anuncia como último não serve de defesa.
      expect(operation.outputContract).toMatch(/ANTES DE RESPONDER/);
    },
  );
});
