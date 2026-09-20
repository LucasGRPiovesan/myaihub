import { describe, expect, it } from 'vitest';
import { assessAgent } from './agent-health.js';
import { emptyAgent, type CanonicalAgent } from './agent.js';
import type { CanonicalItem } from './item.js';

function item(code: string, statement: string, extra: Partial<CanonicalItem> = {}): CanonicalItem {
  return {
    id: `id-${code}`,
    code,
    semanticKey: `key.${code}`,
    label: code,
    statement,
    enforcement: 'SOFT',
    source: 'MYAIHUB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as CanonicalItem;
}

const LONGO = 'Responde direto, sem preâmbulo, e só aprofunda quando a pessoa pedir mais detalhe.';

function agent(overrides: Partial<CanonicalAgent> = {}): CanonicalAgent {
  return { ...emptyAgent('Alex'), ...overrides };
}

describe('diagnóstico do agente', () => {
  it('agente recém-nascido e vazio não é publicável, e diz por quê', () => {
    const health = assessAgent(agent());

    expect(health.publishable).toBe(false);
    const faltando = health.checks.filter((check) => check.status === 'missing');
    expect(faltando.map((check) => check.id)).toContain('objective');
    expect(faltando.map((check) => check.id)).toContain('limits');
    // Cada ponto perdido vem com o que fazer — um medidor mudo ensina a ignorá-lo.
    for (const check of faltando) expect(check.detail.length).toBeGreaterThan(10);
  });

  it('não premia quantidade: trinta itens vagos valem menos que sete densos', () => {
    const vagos = agent({
      objective: { primary: 'vender', secondary: [] },
      limits: [item('LIM01', 'não minta')],
      skills: Array.from({ length: 20 }, (_, index) => item(`SK${index}`, 'faz bem')),
    });
    const densos = agent({
      objective: { primary: 'Converter interessados em clientes.', secondary: [] },
      limits: [item('LIM01', LONGO)],
      personality: [item('PS01', LONGO)],
      communication: [item('CM01', LONGO)],
      skills: [item('SK01', LONGO)],
      behaviors: [item('BH01', LONGO)],
      strategies: [item('ST01', LONGO)],
      hardRules: [item('HR01', LONGO)],
    });

    expect(assessAgent(densos).score).toBeGreaterThan(assessAgent(vagos).score);
  });

  it('aponta os itens rasos pelo código, não só a quantidade', () => {
    const health = assessAgent(agent({ skills: [item('SK01', 'é bom'), item('SK02', LONGO)] }));

    const depth = health.checks.find((check) => check.id === 'depth');
    expect(depth?.detail).toContain('SK01');
    expect(depth?.detail).not.toContain('SK02');
  });

  it('abrir sem roteiro E sem diretriz vira aviso: a primeira frase sai do nada', () => {
    const health = assessAgent(
      agent({
        engagement: {
          initiator: 'AGENT',
          openerMode: 'ADAPTIVE',
          opener: '',
          openerGuidance: '',
        },
      }),
    );

    const abertura = health.checks.find((check) => check.id === 'engagement');
    expect(abertura?.status).toBe('warn');
    expect(abertura?.detail).toContain('sem critério');
  });

  it('abertura adaptativa COM diretriz não é defeito — é o caso normal', () => {
    // Abrir formulando na hora é o comportamento correto na maioria das vezes.
    // Marcá-lo como pendência ensinaria o usuário a fixar saudação para "zerar
    // o aviso" — e saudação fixa foi o problema que originou tudo isto.
    const health = assessAgent(
      agent({
        engagement: {
          initiator: 'AGENT',
          openerMode: 'ADAPTIVE',
          opener: '',
          openerGuidance: 'Cumprimenta, se apresenta e pede o nome.',
        },
      }),
    );

    expect(health.checks.find((check) => check.id === 'engagement')?.status).toBe('ok');
  });

  it('regra sem checker é aviso: ela depende do modelo obedecer', () => {
    const health = assessAgent(agent({ hardRules: [item('HR01', LONGO)] }));

    expect(health.checks.find((check) => check.id === 'verifiable')?.status).toBe('warn');
  });

  it('a nota é estável: o mesmo documento dá sempre o mesmo número', () => {
    const configured = agent({
      objective: { primary: 'Converter interessados.', secondary: [] },
      limits: [item('LIM01', LONGO)],
    });

    expect(assessAgent(configured).score).toBe(assessAgent(configured).score);
  });
});
