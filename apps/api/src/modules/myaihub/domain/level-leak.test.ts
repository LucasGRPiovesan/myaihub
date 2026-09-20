import { describe, expect, it } from 'vitest';
import { findLevelLeaks, levelLeakCorrection, type LevelTerm } from './level-leak.js';

const TERMS: LevelTerm[] = [
  { term: 'Sankar', level: 'PROJECT' },
  { term: 'Linha Industrial Sankar', level: 'CAMPAIGN' },
];

describe('findLevelLeaks', () => {
  it('acusa o caso real: projeto e campanha na identidade, no objetivo e numa skill', () => {
    const leaks = findLevelLeaks(
      [
        { kind: 'SET_AGENT_IDENTITY', name: 'Sankar Atendimento', role: 'Atendente industrial' },
        {
          kind: 'SET_AGENT_OBJECTIVE',
          primary: 'Qualificar demandas para os produtos da Linha Industrial Sankar.',
        },
        {
          kind: 'UPSERT_SKILL',
          label: 'Qualificação e descoberta',
          statement:
            'Antes de apresentar condições da Linha Industrial Sankar, investiga o cenário.',
        },
        { kind: 'UPSERT_SKILL', label: 'Descoberta', statement: 'Investiga o cenário do cliente.' },
      ],
      TERMS,
    );

    expect(leaks.map((leak) => leak.index)).toEqual([0, 1, 2]);
    // O nome mais longo vence: dizer a CAMPANHA explica melhor que o projeto.
    expect(leaks[1]).toMatchObject({ term: 'Linha Industrial Sankar', level: 'CAMPAIGN' });
    expect(leaks[0]).toMatchObject({ term: 'Sankar', level: 'PROJECT' });
    expect(leaks[2]!.where).toBe('UPSERT_SKILL "Qualificação e descoberta"');
  });

  it('casa em caixa alta, que é como regra dura costuma ser escrita', () => {
    const leaks = findLevelLeaks(
      [{ kind: 'UPSERT_HARD_RULE', label: 'x', statement: 'NUNCA fala preço da SANKAR.' }],
      TERMS,
    );
    expect(leaks).toHaveLength(1);
  });

  it('não confunde o nome com a palavra comum de mesmo texto em minúscula', () => {
    const leaks = findLevelLeaks(
      [
        {
          kind: 'UPSERT_SKILL',
          label: 'Venda consultiva',
          statement: 'Conduz a conversa como numa consultoria.',
        },
      ],
      [{ term: 'Consultoria', level: 'PROJECT' }],
    );
    expect(leaks).toEqual([]);
  });

  it('exige a palavra inteira', () => {
    const leaks = findLevelLeaks(
      [{ kind: 'UPSERT_SKILL', label: 'x', statement: 'Fala com os Sankarianos.' }],
      TERMS,
    );
    expect(leaks).toEqual([]);
  });

  it('não olha remoção nem campo estrutural', () => {
    const leaks = findLevelLeaks(
      [
        { kind: 'REMOVE_AGENT_ITEM', itemId: 'SK02', reason: 'Citava a Linha Industrial Sankar.' },
        { kind: 'UPSERT_SKILL', semanticKey: 'skill.sankar', label: 'x', statement: 'ok' },
      ],
      TERMS,
    );
    expect(leaks).toEqual([]);
  });

  it('ignora nome curto demais, que casaria com pedaço de qualquer frase', () => {
    const leaks = findLevelLeaks(
      [{ kind: 'UPSERT_SKILL', label: 'x', statement: 'Usa TI quando precisar.' }],
      [{ term: 'TI', level: 'PROJECT' }],
    );
    expect(leaks).toEqual([]);
  });

  it('a correção nomeia o termo, o campo e o nível', () => {
    const texto = levelLeakCorrection([
      {
        index: 0,
        kind: 'SET_AGENT_IDENTITY',
        where: 'SET_AGENT_IDENTITY',
        term: 'Sankar',
        level: 'PROJECT',
      },
    ]);
    expect(texto).toContain('SET_AGENT_IDENTITY: "Sankar" é do PROJETO');
  });
});
