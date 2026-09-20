import { emptyAgent, type CanonicalItem } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { changesConfiguration } from './material-change.js';

function item(overrides: Partial<CanonicalItem> = {}): CanonicalItem {
  return {
    id: '01',
    code: 'BH03',
    semanticKey: 'behavior.no_operating_model_inference',
    label: 'Não deduz como a pessoa opera',
    statement:
      'NÃO DEDUZ COMO A PESSOA OPERA. Ocupação, cargo e formação não revelam o vínculo ' +
      'dela. Quando precisar dessa informação, PERGUNTE.',
    enforcement: 'HARD',
    source: 'MYAIHUB_BASELINE',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function agentWith(behaviors: CanonicalItem[]) {
  return { ...emptyAgent('Alex'), behaviors } as unknown as Record<string, unknown>;
}

describe('mudou alguma coisa que o usuário sinta?', () => {
  it('carimbo de gravação não é mudança — mesmo texto, versão nenhuma', () => {
    // O caso REAL que motivou isto: a v6 de um agente diferia da v5 só por
    // `source` e `rationale` no mesmo item, com `statement` idêntico. O painel
    // anunciou "ajustei" e o agente respondeu exatamente como antes.
    const before = agentWith([item()]);
    const after = agentWith([
      item({ source: 'USER', rationale: 'Reforço pedido pelo usuário', updatedAt: '2026-02-02' }),
    ]);

    expect(changesConfiguration(before, after)).toBe(false);
  });

  it('reconhece mudança de statement', () => {
    const before = agentWith([item()]);
    const after = agentWith([item({ statement: item().statement + ' Nunca pergunte sobre CLT.' })]);

    expect(changesConfiguration(before, after)).toBe(true);
  });

  it('reconhece mudança de rótulo — ele entra no prompt junto do statement', () => {
    const before = agentWith([item()]);
    const after = agentWith([item({ label: 'Investiga sem microdetalhes' })]);

    expect(changesConfiguration(before, after)).toBe(true);
  });

  it('reconhece mudança de enforcement', () => {
    const before = agentWith([item({ enforcement: 'SOFT' })]);
    const after = agentWith([item({ enforcement: 'HARD' })]);

    expect(changesConfiguration(before, after)).toBe(true);
  });

  it('reconhece item que entrou e item que saiu', () => {
    expect(changesConfiguration(agentWith([]), agentWith([item()]))).toBe(true);
    expect(changesConfiguration(agentWith([item()]), agentWith([]))).toBe(true);
  });

  it('reconhece mudança em campo escalar de configuração', () => {
    const before = agentWith([item()]);
    const after = {
      ...agentWith([item()]),
      engagement: {
        initiator: 'AGENT',
        openerMode: 'ADAPTIVE',
        openerGuidance: 'Abre carismático',
      },
    };

    expect(changesConfiguration(before, after)).toBe(true);
  });

  it('ignora a ordem das chaves — comparar texto bruto acusaria diferença que não existe', () => {
    const before = { skills: [{ semanticKey: 'a', statement: 'x', label: 'A' }] };
    const after = { skills: [{ label: 'A', statement: 'x', semanticKey: 'a' }] };

    expect(changesConfiguration(before, after)).toBe(false);
  });
});
