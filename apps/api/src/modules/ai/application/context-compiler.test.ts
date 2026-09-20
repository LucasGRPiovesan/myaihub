import { describe, expect, it } from 'vitest';
import type { ContextBlock } from '../domain/context.js';
import { ContextCompiler } from './context-compiler.js';

const compiler = new ContextCompiler();

function block(
  id: string,
  kind: ContextBlock['kind'],
  overrides: Partial<ContextBlock> = {},
): ContextBlock {
  return {
    id,
    kind,
    trust: 'TRUSTED',
    priority: 50,
    cacheable: false,
    content: 'x'.repeat(400), // ~100 tokens
    ...overrides,
  };
}

describe('ContextCompiler', () => {
  it('nunca corta TODOS os blocos: o de maior prioridade fica, mesmo acima do teto', () => {
    // O roteador tinha um bloco só, não essencial, e ele passou do teto: a
    // chamada seguiu com 10 tokens de entrada e o S.O perguntava ao usuário o
    // que o contexto cortado dizia.
    const result = compiler.compile({
      blocks: [
        block('instrucao', 'STABLE', { priority: 90 }),
        block('extra', 'KNOWLEDGE', { priority: 10 }),
      ],
      tokenBudget: 50,
    });

    expect(result.blocks.map((item) => item.id)).toEqual(['instrucao']);
    expect(result.dropped.map((item) => item.id)).toEqual(['extra']);
  });

  it('deriva a confiança do tipo, ignorando o que o chamador informou', () => {
    // Se `trust` viesse do chamador, um bloco untrusted marcado errado
    // atravessaria a segregação do Prompt Compiler.
    const result = compiler.compile({
      blocks: [block('site', 'UNTRUSTED', { trust: 'TRUSTED' })],
      tokenBudget: 10_000,
    });

    expect(result.blocks[0]?.trust).toBe('UNTRUSTED');
  });

  it('ordena por tipo, com untrusted por último', () => {
    const result = compiler.compile({
      blocks: [
        block('site', 'UNTRUSTED'),
        block('sessao', 'DYNAMIC'),
        block('policy', 'POLICY'),
        block('agent', 'STABLE'),
        block('kb', 'KNOWLEDGE'),
      ],
      tokenBudget: 100_000,
    });

    expect(result.blocks.map((item) => item.id)).toEqual([
      'policy',
      'agent',
      'kb',
      'sessao',
      'site',
    ]);
  });

  it('produz ordem determinística — é o que faz o cache do provider acertar', () => {
    const blocks = [block('b', 'STABLE'), block('a', 'STABLE'), block('c', 'STABLE')];

    const first = compiler.compile({ blocks, tokenBudget: 100_000 });
    const second = compiler.compile({ blocks: [...blocks].reverse(), tokenBudget: 100_000 });

    expect(first.blocks.map((item) => item.id)).toEqual(second.blocks.map((item) => item.id));
  });

  it('calcula hash e estimativa de tokens de cada bloco', () => {
    const result = compiler.compile({ blocks: [block('a', 'STABLE')], tokenBudget: 10_000 });

    expect(result.blocks[0]?.contentHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.blocks[0]?.tokensEstimate).toBe(100);
  });

  describe('orçamento de tokens', () => {
    it('não corta nada quando cabe', () => {
      const result = compiler.compile({
        blocks: [block('a', 'STABLE'), block('b', 'STABLE')],
        tokenBudget: 10_000,
      });

      expect(result.dropped).toEqual([]);
      expect(result.blocks).toHaveLength(2);
    });

    it('corta os blocos de menor prioridade primeiro', () => {
      const result = compiler.compile({
        blocks: [
          block('essencial', 'STABLE', { priority: 90 }),
          block('dispensavel', 'KNOWLEDGE', { priority: 10 }),
        ],
        tokenBudget: 150,
      });

      expect(result.blocks.map((item) => item.id)).toEqual(['essencial']);
      expect(result.dropped.map((item) => item.id)).toEqual(['dispensavel']);
    });

    it('NUNCA corta o que é ESSENCIAL, nem com prioridade mínima', () => {
      // O contrato de saída precisa das duas pontas opostas: prioridade mínima
      // para ficar por último no prompt, e proteção máxima para nunca sair. Com
      // um número só respondendo às duas perguntas, ele era — por construção —
      // o primeiro a ser descartado.
      const result = compiler.compile({
        blocks: [
          block('contrato', 'DYNAMIC', { priority: 1, essential: true }),
          block('kb', 'KNOWLEDGE', { priority: 99 }),
        ],
        tokenBudget: 50,
      });

      expect(result.blocks.map((item) => item.id)).toContain('contrato');
    });

    it('corta POLICY antes de cortar o ALVO da operação', () => {
      // A policy só cresce, e era protegida incondicionalmente. Medido num
      // ajuste real: 9.868 tokens de seções num teto de 18.000 empurraram para
      // fora o `agent.core` — o OS reconfigurou um agente sem enxergar o
      // agente, e o corte não aparece em lugar nenhum. Orientação é importante;
      // o alvo É a operação.
      const result = compiler.compile({
        blocks: [
          block('policy.uma', 'POLICY', { priority: 60 }),
          block('agent.core', 'STABLE', { priority: 85, essential: true }),
        ],
        tokenBudget: 150,
      });

      expect(result.blocks.map((item) => item.id)).toContain('agent.core');
      expect(result.dropped.map((item) => item.id)).toContain('policy.uma');
    });

    it('registra o que cortou, com motivo — corte silencioso é irrastreável', () => {
      const result = compiler.compile({
        blocks: [block('a', 'STABLE', { priority: 90 }), block('b', 'KNOWLEDGE', { priority: 1 })],
        tokenBudget: 150,
      });

      expect(result.dropped[0]).toMatchObject({
        id: 'b',
        kind: 'KNOWLEDGE',
        reason: 'TOKEN_BUDGET',
        tokensEstimate: 100,
      });
    });

    it('para de cortar assim que cabe no orçamento', () => {
      const result = compiler.compile({
        blocks: [
          block('a', 'STABLE', { priority: 90 }),
          block('b', 'KNOWLEDGE', { priority: 20 }),
          block('c', 'KNOWLEDGE', { priority: 10 }),
        ],
        tokenBudget: 250,
      });

      // 300 tokens no total, orçamento 250: basta cortar um.
      expect(result.dropped).toHaveLength(1);
      expect(result.dropped[0]?.id).toBe('c');
    });

    it('mantém a soma de tokens coerente com os blocos mantidos', () => {
      const result = compiler.compile({
        blocks: [block('a', 'STABLE', { priority: 90 }), block('b', 'KNOWLEDGE', { priority: 1 })],
        tokenBudget: 150,
      });

      const sum = result.blocks.reduce((total, item) => total + item.tokensEstimate, 0);
      expect(result.tokensEstimate).toBe(sum);
    });
  });
});
