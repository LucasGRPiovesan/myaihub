import { describe, expect, it } from 'vitest';
import type { AgentPlaybook } from './playbook.js';
import { playbookFloorMutations, preserveEnforcement } from './playbook-floor.js';

function playbook(key: string, principles: AgentPlaybook['principles']): AgentPlaybook {
  return {
    key,
    label: key,
    appliesTo: [],
    thesis: 'x'.repeat(30),
    principles,
    antiPatterns: [],
    alreadyAnswered: [],
    worthAsking: [],
    sources: [],
  } as unknown as AgentPlaybook;
}

const CONDUTA = playbook('core.conduct', [
  {
    code: 'PR01',
    semanticKey: 'behavior.no_inference',
    label: 'Não deduz',
    facet: 'behaviors',
    statement: 'O texto CURADO, longo e calibrado contra um erro real que já aconteceu.',
    enforcement: 'HARD',
  },
] as unknown as AgentPlaybook['principles']);

const OFICIO = playbook('sales.consultive', [
  {
    code: 'PR01',
    semanticKey: 'behavior.no_inference',
    label: 'Não deduz (versão do papel)',
    facet: 'behaviors',
    statement: 'A paráfrase curta que o OS escreveu.',
  },
] as unknown as AgentPlaybook['principles']);

describe('piso do ofício', () => {
  it('a chave semântica é única: a CONDUTA vence o ofício', () => {
    // Os dois playbooks declararam o mesmo conceito. Aplicar ambos fazia o
    // segundo sobrescrever o primeiro em silêncio — aconteceu de verdade: o
    // princípio curado de 682 caracteres virou uma paráfrase de 335 escrita
    // pelo OS no playbook do papel, e o agente recebeu a versão pior.
    const mutacoes = playbookFloorMutations([CONDUTA, OFICIO]) as Array<{ statement: string }>;

    expect(mutacoes).toHaveLength(1);
    expect(mutacoes[0]?.statement).toContain('CURADO');
  });

  it('princípio declarado HARD chega HARD', () => {
    // Proibição que nasce SOFT fica no meio da lista da faceta em vez de subir
    // para "REGRAS INEGOCIÁVEIS" — enfraquece exatamente o que deveria valer.
    const mutacoes = playbookFloorMutations([CONDUTA]) as Array<{ enforcement: string }>;

    expect(mutacoes[0]?.enforcement).toBe('HARD');
  });

  it('sem declaração, entra como orientação', () => {
    const mutacoes = playbookFloorMutations([OFICIO]) as Array<{ enforcement: string }>;

    expect(mutacoes[0]?.enforcement).toBe('SOFT');
  });
});

describe('o piso não rebaixa a força', () => {
  it('mantém o HARD que o agente já tinha', () => {
    // Sincronizar o texto não pode desfazer a decisão de quem projetou o
    // agente: o item cairia para SOFT e SAIRIA do bloco inegociável do prompt,
    // enfraquecendo em silêncio a regra que a sincronização vinha reforçar.
    const resultado = preserveEnforcement(
      [{ kind: 'UPSERT_BEHAVIOR', semanticKey: 'behavior.x', enforcement: 'SOFT' }],
      { behaviors: [{ semanticKey: 'behavior.x', enforcement: 'HARD' }] },
    ) as Array<{ enforcement: string }>;

    expect(resultado[0]?.enforcement).toBe('HARD');
  });

  it('não promove além do que o piso pediu', () => {
    const resultado = preserveEnforcement(
      [{ kind: 'UPSERT_BEHAVIOR', semanticKey: 'behavior.x', enforcement: 'HARD' }],
      { behaviors: [{ semanticKey: 'behavior.x', enforcement: 'SOFT' }] },
    ) as Array<{ enforcement: string }>;

    expect(resultado[0]?.enforcement).toBe('HARD');
  });

  it('não herda DETERMINISTIC: o piso não traz checker', () => {
    // O painel exibe "verificada em código" para DETERMINISTIC, e isso não pode
    // mentir. Sem checker registrado, o mais forte honesto é HARD.
    const resultado = preserveEnforcement(
      [{ kind: 'UPSERT_BEHAVIOR', semanticKey: 'behavior.x', enforcement: 'SOFT' }],
      { behaviors: [{ semanticKey: 'behavior.x', enforcement: 'DETERMINISTIC' }] },
    ) as Array<{ enforcement: string }>;

    expect(resultado[0]?.enforcement).toBe('HARD');
  });
});
