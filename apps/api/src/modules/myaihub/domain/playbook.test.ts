import { describe, expect, it } from 'vitest';
import {
  agentPlaybookSchema,
  compilePlaybookForPrompt,
  describeCatalogForPrompt,
  toCatalogEntry,
  type AgentPlaybook,
} from './playbook.js';
import { PLAYBOOK_SEEDS } from '../infrastructure/playbooks.seed.js';
import { applyPlaybookMutations } from './playbook-mutations.js';

function playbook(overrides: Partial<AgentPlaybook> = {}): AgentPlaybook {
  return agentPlaybookSchema.parse({
    key: 'test.role',
    label: 'Papel de teste',
    appliesTo: ['qualquer coisa'],
    thesis: 'Uma tese suficientemente longa para passar no mínimo do schema.',
    principles: [
      {
        code: 'PR01',
        semanticKey: 'skill.um',
        facet: 'skills',
        label: 'Item um',
        statement: 'Faz alguma coisa concreta antes de propor outra coisa.',
      },
      {
        code: 'PR02',
        semanticKey: 'skill.dois',
        facet: 'skills',
        label: 'Item dois',
        statement: 'Faz outra coisa concreta, também antes de propor.',
      },
      {
        code: 'PR03',
        semanticKey: 'communication.curto',
        facet: 'communication',
        label: 'Curto',
        statement: 'Escreve curto e direto, sem preâmbulo nenhum.',
      },
    ],
    ...overrides,
  });
}

describe('playbook de ofício', () => {
  it('declara o alvo por faceta, em número, somando os playbooks aplicados', () => {
    // O alvo em número é o que faz o modelo cobrir o playbook inteiro. Sem ele,
    // medido contra o Gemini real: catorze princípios viravam nove itens, e os
    // perdidos eram justamente os específicos do ofício.
    const compiled = compilePlaybookForPrompt([
      playbook(),
      playbook({
        key: 'core.conduct',
        principles: [
          {
            code: 'PR01',
            semanticKey: 'communication.espelha',
            facet: 'communication',
            label: 'Espelha',
            statement: 'Espelha o registro de quem fala com ele.',
          },
          {
            code: 'PR02',
            semanticKey: 'behavior.admite',
            facet: 'behaviors',
            label: 'Admite',
            statement: 'Admite o que não sabe em vez de improvisar.',
          },
          {
            code: 'PR03',
            semanticKey: 'behavior.nao_repete',
            facet: 'behaviors',
            label: 'Não repete',
            statement: 'Não repete o que já foi dito na conversa.',
          },
        ],
      }),
    ]);

    expect(compiled).toContain('skills 2');
    // Somado: uma comunicação de cada playbook.
    expect(compiled).toContain('communication 2');
    expect(compiled).toContain('behaviors 2');
    expect(compiled).toContain('PRINCÍPIOS (6)');
  });

  it('o alvo é PISO, não teto', () => {
    // Declarado como teto, o alvo suprimia a conduta base: com "comunicação 1"
    // no playbook de ofício, o agente saía sem espelhar o registro.
    expect(compilePlaybookForPrompt([playbook()])).toContain('PISO, não teto');
  });

  it('sem playbook aplicável não produz bloco nenhum', () => {
    // String vazia é o sinal de "não monte o bloco". Um bloco com cabeçalho e
    // nada dentro seria contexto pago para não dizer nada.
    expect(compilePlaybookForPrompt([])).toBe('');
  });

  it('anti-padrão vira limite, e o número aparece', () => {
    const compiled = compilePlaybookForPrompt([
      playbook({
        antiPatterns: [
          {
            code: 'LM01',
            semanticKey: 'limit.um',
            label: 'Item um',
            statement: 'Nunca faz a coisa errada.',
          },
          {
            code: 'LM02',
            semanticKey: 'limit.dois',
            label: 'Item dois',
            statement: 'Nunca faz a outra errada.',
          },
        ],
      }),
    ]);

    expect(compiled).toContain('LIMITES (2)');
  });

  it('o catálogo do classificador não carrega o conteúdo do playbook', () => {
    // Só chave, rótulo e a que se aplica. Mandar princípios e limites de todos
    // os playbooks para classificar UM papel encareceria a cada playbook novo.
    const entry = toCatalogEntry(playbook());

    expect(Object.keys(entry).sort()).toEqual(['appliesTo', 'key', 'label']);
    expect(describeCatalogForPrompt([entry])).toContain('test.role');
    expect(describeCatalogForPrompt([])).toContain('nenhum playbook');
  });
});

describe('sementes de playbook', () => {
  it('toda semente é válida contra o schema', () => {
    // Semente inválida não falharia no boot: o repositório a descarta e o OS
    // volta a projetar sem ofício, em silêncio. Aqui ela falha alto.
    for (const seed of PLAYBOOK_SEEDS) {
      expect(agentPlaybookSchema.safeParse(seed).success, seed.key).toBe(true);
    }
  });

  it('playbook de PAPEL declara o que perguntar; o de PISO não pergunta nada', () => {
    // As perguntas do briefing saem do playbook do papel. O piso vale para todo
    // agente e não tem pergunta própria — se tivesse, ela seria feita sempre.
    for (const seed of PLAYBOOK_SEEDS) {
      if (seed.key.startsWith('core.')) {
        expect(seed.worthAsking, seed.key).toHaveLength(0);
        continue;
      }
      expect(seed.worthAsking.length, seed.key).toBeGreaterThan(0);
      for (const question of seed.worthAsking) {
        expect(question.why.length, question.question).toBeGreaterThan(10);
      }
    }
  });
});

/**
 * O PISO não encolhe.
 *
 * O agente já tinha essa garantia; o playbook não, e ele vale para todo agente
 * futuro daquele papel. Medido: um princípio curado de 682 caracteres — com a
 * cláusula que fazia a regra funcionar — voltou do modelo com 433 e a cláusula
 * fora. A versão curta parecia uma correção legítima, e nada acusava.
 */
describe('refinar princípio não pode perder precisão', () => {
  const base: AgentPlaybook = {
    key: 'core.conduct',
    label: 'Conduta',
    appliesTo: [],
    thesis: 'x'.repeat(40),
    principles: [
      {
        code: 'PR01',
        semanticKey: 'behavior.no_inference',
        facet: 'behaviors',
        label: 'Não deduz',
        statement:
          'O texto longo e calibrado, com a cláusula concreta que faz a regra funcionar na ' +
          'prática e que uma reescrita apressada joga fora sem ninguém perceber.',
      },
    ],
    antiPatterns: [],
    alreadyAnswered: [],
    worthAsking: [],
    sources: [],
  } as unknown as AgentPlaybook;

  it('mantém o texto anterior quando o novo encolhe demais', () => {
    const resultado = applyPlaybookMutations(
      base,
      [
        {
          kind: 'UPSERT_PRINCIPLE',
          semanticKey: 'behavior.no_inference',
          facet: 'behaviors',
          label: 'Não deduz',
          statement: 'Versão curta que perdeu a cláusula.',
        },
      ] as never,
      ['UPSERT_PRINCIPLE'],
    );

    expect(resultado.playbook.principles[0]?.statement).toContain('cláusula concreta');
    expect(resultado.adjustments.join(' ')).toContain('perderia detalhe');
  });

  it('aceita reescrita que ficou só um pouco mais enxuta', () => {
    const enxuta =
      'O texto longo e calibrado, com a cláusula concreta que faz a regra funcionar na ' +
      'prática e que uma reescrita apressada descarta.';

    const resultado = applyPlaybookMutations(
      base,
      [
        {
          kind: 'UPSERT_PRINCIPLE',
          semanticKey: 'behavior.no_inference',
          facet: 'behaviors',
          label: 'Não deduz',
          statement: enxuta,
        },
      ] as never,
      ['UPSERT_PRINCIPLE'],
    );

    expect(resultado.playbook.principles[0]?.statement).toBe(enxuta);
  });
});
