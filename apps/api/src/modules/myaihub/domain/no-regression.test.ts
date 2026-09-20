import { emptyAgent, type CanonicalItem } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { guardAgainstRegression, keepNonEmpty } from './no-regression.js';

const FACETS = ['communication', 'hardRules'] as const;

function item(overrides: Partial<CanonicalItem> = {}): CanonicalItem {
  return {
    id: '01',
    code: 'CM01',
    semanticKey: 'communication.objectivity',
    label: 'Objetividade',
    statement:
      'Responde direto antes de contextualizar, sem introdução, sem repetir o que já ' +
      'foi dito, e só aprofunda quando a pergunta pede.',
    enforcement: 'SOFT',
    source: 'MYAIHUB',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function agentWith(communication: CanonicalItem[], hardRules: CanonicalItem[] = []) {
  return { ...emptyAgent('Philips'), communication, hardRules } as unknown as Record<
    string,
    unknown
  >;
}

describe('nunca regredir (§65)', () => {
  it('restaura item que sumiria sem remoção pedida', () => {
    const before = agentWith([item()]);
    const after = agentWith([]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    expect(result.canonical['communication'] as CanonicalItem[]).toHaveLength(1);
    expect(result.restored[0]).toContain('sumiria');
  });

  it('deixa sumir o que o usuário mandou remover — isso não é regressão', () => {
    const before = agentWith([item()]);
    const after = agentWith([]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(['communication.objectivity']),
    });

    expect(result.canonical['communication']).toHaveLength(0);
    expect(result.restored).toHaveLength(0);
  });

  it('desfaz o encolhimento do statement — trocar instrução por adjetivo é perda', () => {
    const before = agentWith([item()]);
    const after = agentWith([item({ statement: 'Seja objetivo.' })]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    const kept = (result.canonical['communication'] as CanonicalItem[])[0];
    expect(kept?.statement).toContain('sem introdução');
    expect(result.restored[0]).toContain('perderia detalhe');
  });

  it('aceita reescrita que ficou um pouco mais enxuta', () => {
    const before = agentWith([item()]);
    const shorter = item({ statement: item().statement.slice(0, -12) });
    const after = agentWith([shorter]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    // Margem existe para não acusar toda reescrita legítima.
    expect(result.restored).toHaveLength(0);
  });

  it('aceita statement mais LONGO — é o refinamento funcionando', () => {
    const before = agentWith([item()]);
    const after = agentWith([item({ statement: `${item().statement} Também evita jargão.` })]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    expect(result.restored).toHaveLength(0);
    expect((result.canonical['communication'] as CanonicalItem[])[0]?.statement).toContain(
      'jargão',
    );
  });

  it('impede rebaixar enforcement sem pedido', () => {
    const rule = item({ semanticKey: 'hard_rule.uma_pergunta', enforcement: 'HARD' });
    const before = agentWith([], [rule]);
    const after = agentWith([], [item({ ...rule, enforcement: 'SOFT' })]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    // Regra obrigatória virando preferência deixa de valer sem ninguém notar.
    expect((result.canonical['hardRules'] as CanonicalItem[])[0]?.enforcement).toBe('HARD');
    expect(result.restored[0]).toContain('rebaixada');
  });

  it('permite SUBIR o enforcement', () => {
    const before = agentWith([], [item({ enforcement: 'SOFT' })]);
    const after = agentWith([], [item({ enforcement: 'HARD' })]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    expect((result.canonical['hardRules'] as CanonicalItem[])[0]?.enforcement).toBe('HARD');
    expect(result.restored).toHaveLength(0);
  });

  it('não inventa nada quando o ajuste só acrescenta', () => {
    const before = agentWith([item()]);
    const after = agentWith([item(), item({ id: '02', semanticKey: 'communication.clareza' })]);

    const result = guardAgainstRegression({
      before,
      after,
      facets: FACETS,
      removedKeys: new Set(),
    });

    expect(result.canonical['communication']).toHaveLength(2);
    expect(result.restored).toHaveLength(0);
  });
});

describe('campo de texto único', () => {
  it('não deixa o objetivo ser apagado por um ajuste', () => {
    const restored: string[] = [];
    expect(keepNonEmpty('Converter leads.', '', 'O objetivo', restored)).toBe('Converter leads.');
    expect(restored).toHaveLength(1);
  });

  it('deixa reescrever para outro texto', () => {
    const restored: string[] = [];
    expect(keepNonEmpty('Antigo.', 'Novo.', 'O objetivo', restored)).toBe('Novo.');
    expect(restored).toHaveLength(0);
  });
});

describe('a abertura também não pode regredir', () => {
  const GUIA =
    'Cumprimenta em uma linha, se apresenta pelo nome e vai direto ao motivo do contato.';

  function withEngagement(engagement: Record<string, string>) {
    return { ...emptyAgent('Alex'), engagement } as unknown as Record<string, unknown>;
  }

  it('um ajuste sobre outra coisa não apaga a orientação de abertura', () => {
    // `engagement` é objeto de campos escalares, fora do guard de itens. Sem
    // proteção, o usuário reestabelecia a mesma abertura a cada rodada porque o
    // que ele tinha definido antes não sobrevivia ao ajuste seguinte.
    const result = guardAgainstRegression({
      before: withEngagement({
        initiator: 'AGENT',
        openerMode: 'ADAPTIVE',
        opener: '',
        openerGuidance: GUIA,
      }),
      after: withEngagement({
        initiator: 'AGENT',
        openerMode: 'ADAPTIVE',
        opener: '',
        openerGuidance: '',
      }),
      facets: FACETS,
      removedKeys: new Set<string>(),
    });

    const engagement = result.canonical['engagement'] as Record<string, string>;
    expect(engagement['openerGuidance']).toBe(GUIA);
    expect(result.restored.join(' ')).toContain('orientação de abertura');
  });

  it('a saudação fixa sobrevive enquanto o modo continuar sendo roteiro', () => {
    const result = guardAgainstRegression({
      before: withEngagement({
        initiator: 'AGENT',
        openerMode: 'SCRIPTED',
        opener: 'Oi! Sou o Alex.',
        openerGuidance: '',
      }),
      after: withEngagement({
        initiator: 'AGENT',
        openerMode: 'SCRIPTED',
        opener: '',
        openerGuidance: '',
      }),
      facets: FACETS,
      removedKeys: new Set<string>(),
    });

    expect((result.canonical['engagement'] as Record<string, string>)['opener']).toBe(
      'Oi! Sou o Alex.',
    );
  });

  it('trocar de roteiro para adaptativo é escolha, não perda', () => {
    // Foi exatamente isto que o usuário pediu ao dizer "a saudação não pode ser
    // fixa". Restaurar aqui seria desfazer o que ele acabou de mandar fazer.
    const result = guardAgainstRegression({
      before: withEngagement({
        initiator: 'AGENT',
        openerMode: 'SCRIPTED',
        opener: 'Oi! Sou o Alex.',
        openerGuidance: '',
      }),
      after: withEngagement({
        initiator: 'AGENT',
        openerMode: 'ADAPTIVE',
        opener: '',
        openerGuidance: GUIA,
      }),
      facets: FACETS,
      removedKeys: new Set<string>(),
    });

    const engagement = result.canonical['engagement'] as Record<string, string>;
    expect(engagement['openerMode']).toBe('ADAPTIVE');
    expect(engagement['opener']).toBe('');
  });
});
