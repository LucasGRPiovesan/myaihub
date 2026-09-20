import { defaultBrandIdentity } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import type { MutationContext } from '../../myaihub/domain/mutation-applier.js';
import {
  BrandIdentityMutationApplier,
  contrastRatio,
  readableOn,
} from './brand-mutation-applier.js';
import type { BrandMutationKind } from './brand-mutations.js';

const applier = new BrandIdentityMutationApplier();

function contexto(
  allowedMutations: readonly BrandMutationKind[] = ['SET_BRAND_IDENTITY'],
): MutationContext<BrandMutationKind> {
  return {
    allowedMutations,
    now: new Date('2026-09-03T00:00:00Z'),
    nextId: () => '01JBRANDTESTIDXXXXXXXXXXXX',
    source: 'USER',
    validateCheck: () => ({ ok: false, reason: 'A identidade de marca não tem checkers.' }),
  };
}

describe('mutação de identidade de marca', () => {
  it('faz MERGE: o campo não citado permanece', () => {
    const atual = {
      ...defaultBrandIdentity('Sankar'),
      legalFooter: 'CNPJ 00.000.000/0001-00',
      tagline: 'Peças sob medida',
    };

    const { canonical } = applier.apply(
      atual,
      [{ kind: 'SET_BRAND_IDENTITY', primaryColor: '#0f172a' }],
      contexto(),
    );

    expect(canonical.colors.primary).toBe('#0f172a');
    // O pedido foi trocar a cor. Devolver o documento inteiro faria o modelo
    // reescrever o rodapé legal que ninguém mencionou.
    expect(canonical.legalFooter).toBe('CNPJ 00.000.000/0001-00');
    expect(canonical.tagline).toBe('Peças sob medida');
  });

  it('calcula a cor do texto quando só a principal muda', () => {
    const { canonical, adjustments } = applier.apply(
      defaultBrandIdentity('Sankar'),
      // Amarelo claro: com o branco padrão, o texto ficaria ilegível — e quem
      // publica não descobre isso antes de um cliente reclamar.
      [{ kind: 'SET_BRAND_IDENTITY', primaryColor: '#ffe066' }],
      contexto(),
    );

    expect(canonical.colors.onPrimary).toBe('#111111');
    expect(adjustments).toHaveLength(1);
  });

  it('NÃO sobrescreve a cor do texto quando o usuário a declarou', () => {
    const { canonical, adjustments } = applier.apply(
      defaultBrandIdentity('Sankar'),
      [{ kind: 'SET_BRAND_IDENTITY', primaryColor: '#ffe066', onPrimaryColor: '#ffffff' }],
      contexto(),
    );

    expect(canonical.colors.onPrimary).toBe('#ffffff');
    expect(adjustments).toHaveLength(0);
  });

  it('a lista de palavras a evitar é substituída, não somada', () => {
    const atual = {
      ...defaultBrandIdentity('Sankar'),
      voice: { tone: 'NEUTRO' as const, guidance: '', avoid: ['imperdível'] },
    };

    const { canonical } = applier.apply(
      atual,
      [{ kind: 'SET_BRAND_IDENTITY', avoid: ['promoção relâmpago'] }],
      contexto(),
    );

    expect(canonical.voice.avoid).toEqual(['promoção relâmpago']);
  });

  it('recusa mutação fora do que a operação permite', () => {
    const { rejected, canonical } = applier.apply(
      defaultBrandIdentity('Sankar'),
      [{ kind: 'SET_BRAND_IDENTITY', displayName: 'Outro' }],
      contexto([]),
    );

    expect(rejected).toHaveLength(1);
    expect(canonical.displayName).toBe('Sankar');
  });
});

describe('contraste legível', () => {
  it('texto escuro sobre fundo claro, claro sobre escuro', () => {
    expect(readableOn('#ffffff')).toBe('#111111');
    expect(readableOn('#000000')).toBe('#ffffff');
    expect(readableOn('#1f6feb')).toBe('#ffffff');
    expect(readableOn('#ffe066')).toBe('#111111');
  });

  it('a razão de contraste bate com a escala da WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 1);
  });
});

/*
  A paleta pode vir de uma VARREDURA de site, onde fundo e texto foram colhidos
  de regras CSS diferentes — sem nenhuma garantia de que conviviam no mesmo
  lugar. Publicar isso sem conferir é entregar uma tela que o visitante não lê,
  e ele veio de um anúncio pago.
*/
describe('a paleta extraída não pode sair ilegível', () => {
  const applier = new BrandIdentityMutationApplier();

  it('corrige texto sem contraste com a superfície, e diz o que fez', () => {
    const { canonical, adjustments } = applier.apply(
      defaultBrandIdentity('Sankar'),
      [
        {
          kind: 'SET_BRAND_IDENTITY',
          surfaceColor: '#ffffff',
          // Cinza clarinho sobre branco: 1,6:1. Reprova no piso de 4,5:1.
          textColor: '#d8d8d8',
        },
      ],
      contexto(),
    );

    expect(canonical.colors.text).toBe('#111111');
    expect(adjustments.join(' ')).toContain('contraste');
  });

  it('corrige vantagem/desvantagem sem contraste, e diz qual das duas', () => {
    const { canonical, adjustments } = applier.apply(
      defaultBrandIdentity('Sankar'),
      [
        {
          kind: 'SET_BRAND_IDENTITY',
          // Verde e vermelho quase pastel sobre branco: abaixo do piso de 3:1.
          successColor: '#bfe6cc',
          dangerColor: '#f0c9c0',
        },
      ],
      contexto(),
    );

    expect(canonical.colors.success).not.toBe('#bfe6cc');
    expect(canonical.colors.danger).not.toBe('#f0c9c0');
    expect(adjustments.join(' ')).toContain('vantagem');
    expect(adjustments.join(' ')).toContain('desvantagem');
  });

  it('não mexe num par que já é legível', () => {
    const { canonical, adjustments } = applier.apply(
      defaultBrandIdentity('Sankar'),
      [
        {
          kind: 'SET_BRAND_IDENTITY',
          surfaceColor: '#16160f',
          textColor: '#eeece0',
          // O default de vantagem/desvantagem é para SUPERFÍCIE CLARA — sobre
          // um fundo escuro ele reprovaria o mesmo piso, e o teste deixaria de
          // provar "não mexe quando já está bom" para provar sem querer
          // "corrige um default incoerente com o resto do pedido".
          successColor: '#4fbf82',
          dangerColor: '#e2705a',
        },
      ],
      contexto(),
    );

    expect(canonical.colors.text).toBe('#eeece0');
    expect(canonical.colors.success).toBe('#4fbf82');
    expect(canonical.colors.danger).toBe('#e2705a');
    expect(adjustments).toEqual([]);
  });

  it('grava tipografia e forma como vieram, quando são válidas', () => {
    const { canonical } = applier.apply(
      defaultBrandIdentity('Sankar'),
      [
        {
          kind: 'SET_BRAND_IDENTITY',
          headingFamily: 'Poppins',
          bodyFamily: 'Inter',
          fontSource: 'GOOGLE',
          shape: 'ROUND',
        },
      ],
      contexto(),
    );

    expect(canonical.typography).toEqual({
      headingFamily: 'Poppins',
      bodyFamily: 'Inter',
      source: 'GOOGLE',
    });
    expect(canonical.shape).toBe('ROUND');
  });
});
