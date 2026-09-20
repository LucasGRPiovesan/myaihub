import { describe, expect, it } from 'vitest';
import { promptJson } from './prompt-json.js';
import { sectionsFor } from './request-signals.js';

const SECOES = [
  'core',
  'information_level',
  'diagnosis',
  'calibration_level',
  'examples',
  'ephemeral_facts',
];

describe('sectionsFor', () => {
  it('sem classificação, carrega TUDO — o padrão seguro é o de antes', () => {
    expect(sectionsFor(SECOES, undefined)).toEqual(SECOES);
  });

  it('pedido comum não carrega orientação de situação que ele não tem', () => {
    expect(sectionsFor(SECOES, [])).toEqual(['core', 'information_level']);
  });

  it('relato de falha traz diagnóstico, calibração e fato efêmero', () => {
    expect(sectionsFor(SECOES, ['FAILURE_REPORT'])).toEqual([
      'core',
      'information_level',
      'diagnosis',
      'calibration_level',
      'ephemeral_facts',
    ]);
  });

  it('conversa de teste anexada conta como fala de terceiro', () => {
    expect(sectionsFor(SECOES, [], { hasTestTranscript: true })).toContain('ephemeral_facts');
  });
});

describe('promptJson', () => {
  it('tira escrituração e espaço, e mantém o que o modelo usa para decidir', () => {
    const texto = promptJson({
      skills: [
        {
          id: '01A',
          code: 'SK01',
          semanticKey: 'skill.x',
          label: 'X',
          statement: 'faz x',
          enforcement: 'HARD',
          source: 'USER',
          rationale: 'porque sim',
          originHubMessageId: '01M',
          createdAt: '2026',
          updatedAt: '2026',
        },
      ],
      limits: [],
    });

    expect(JSON.parse(texto)).toEqual({
      skills: [
        {
          id: '01A',
          code: 'SK01',
          semanticKey: 'skill.x',
          label: 'X',
          statement: 'faz x',
          enforcement: 'HARD',
          source: 'USER',
        },
      ],
    });
    expect(texto).not.toContain('\n');
  });
});
