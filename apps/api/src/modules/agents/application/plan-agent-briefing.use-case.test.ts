import { describe, expect, it } from 'vitest';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import { agentPlaybookSchema, type AgentPlaybook } from '../../myaihub/domain/playbook.js';
import type { PlaybookRepository, PolicyRepository } from '../../myaihub/domain/repositories.js';
import { systemTenantContext } from '../../../shared/application/tenant-context.js';
import { PlanAgentBriefingUseCase } from './plan-agent-briefing.use-case.js';

const CONTEXT = systemTenantContext('teste');

const SALES: AgentPlaybook = agentPlaybookSchema.parse({
  key: 'sales.consultive',
  label: 'Representante comercial consultivo',
  appliesTo: ['vendedor'],
  thesis: 'Entende antes de propor, e não empurra nada para ninguém em nenhum momento.',
  principles: [
    {
      code: 'PR01',
      semanticKey: 'skill.diagnostica',
      facet: 'skills',
      label: 'Diagnostica',
      statement: 'Diagnostica antes de propor qualquer coisa a alguém.',
    },
    {
      code: 'PR02',
      semanticKey: 'behavior.para',
      facet: 'behaviors',
      label: 'Para de perguntar',
      statement: 'Para de perguntar assim que já entendeu o problema.',
    },
    {
      code: 'PR03',
      semanticKey: 'personality.autonomia',
      facet: 'personality',
      label: 'Autonomia',
      statement: 'Preserva a autonomia de quem está do outro lado.',
    },
  ],
  worthAsking: [
    {
      code: 'PG01',
      semanticKey: 'ask.setor',
      question: 'Em que setor ele vende?',
      why: 'Muda vocabulário e objeção típica.',
    },
    {
      code: 'PG02',
      semanticKey: 'ask.canal',
      question: 'Por qual canal?',
      why: 'Muda o tamanho de cada mensagem.',
    },
  ],
});

const CORE: AgentPlaybook = agentPlaybookSchema.parse({
  key: 'core.conduct',
  label: 'Conduta base',
  appliesTo: ['todo agente'],
  thesis: 'Acompanha o jeito de quem fala com ele e admite o que não sabe, sempre.',
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
      semanticKey: 'communication.tamanho',
      facet: 'communication',
      label: 'Tamanho',
      statement: 'Responde no tamanho da pergunta, sem encher.',
    },
    {
      code: 'PR03',
      semanticKey: 'behavior.admite',
      facet: 'behaviors',
      label: 'Admite',
      statement: 'Admite o que não sabe em vez de improvisar.',
    },
  ],
});

function repositories(playbooks: AgentPlaybook[]) {
  const misses: string[] = [];

  const playbookRepository: PlaybookRepository = {
    listCurrent: async () => playbooks,
    findByKey: async (key) => playbooks.find((item) => item.key === key) ?? null,
    findCurrent: async (key) => {
      const playbook = playbooks.find((item) => item.key === key);
      return playbook ? { playbook, versionNumber: 1 } : null;
    },
    seedMissing: async () => [],
    recordMiss: async (_context, role) => {
      misses.push(role);
    },
    // O briefing não administra playbook; estes existem para o contrato, não
    // para o teste — e falhar alto é melhor que devolver vazio em silêncio.
    listForAdmin: () => Promise.reject(new Error('não usado no briefing')),
    saveVersion: () => Promise.reject(new Error('não usado no briefing')),
    history: () => Promise.reject(new Error('não usado no briefing')),
    listMisses: () => Promise.reject(new Error('não usado no briefing')),
    recordSuggestion: () => Promise.reject(new Error('não usado no briefing')),
    listSuggestions: () => Promise.reject(new Error('não usado no briefing')),
    countAgentsByPlaybook: () => Promise.reject(new Error('não usado no briefing')),
  };

  const policies: PolicyRepository = {
    getCurrent: async () => null,
    ensureSeeded: async () => ({ id: 'x', versionNumber: 1, sections: {} }),
    syncSections: async () => ({
      version: { id: 'x', versionNumber: 1, sections: {} },
      added: [],
      updated: [],
    }),
  };

  return { playbookRepository, policies, misses };
}

/** Gateway falso: devolve o que o "modelo" teria decidido, sem chamar ninguém. */
function gatewayReturning(content: unknown): LlmGateway {
  return {
    generateStructured: async () => ({
      content,
      raw: '',
      usage: {},
      model: 'fake',
      finishReason: 'stop',
      aiCallId: 'a',
      costMicros: 0,
      totalTokens: 0,
    }),
  } as unknown as LlmGateway;
}

describe('briefing antes de criar o agente', () => {
  it('com playbook, as perguntas vêm CURADAS dele — não do modelo', async () => {
    // Foi a queixa direta: o OS perguntava o que ele mesmo já deveria saber.
    // Quem conhece o ofício é quem escreveu o playbook, e a resposta dele não
    // pode variar a cada chamada (§31).
    const { playbookRepository, policies, misses } = repositories([CORE, SALES]);
    const useCase = new PlanAgentBriefingUseCase({
      gateway: gatewayReturning({
        playbookKey: 'sales.consultive',
        questions: [{ question: 'Qual o preço do produto?', why: 'inventada', placeholder: '' }],
      }),
      policies,
      playbooks: playbookRepository,
    });

    const result = await useCase.execute(CONTEXT, 'Representante comercial');

    expect(result.playbookKey).toBe('sales.consultive');
    expect(result.playbookLabel).toBe('Representante comercial consultivo');
    // A primeira é sempre a de iniciativa, fixa em código — seguida de nome
    // e liga/desliga de respostas recomendadas, também fixas.
    expect(result.questions[0]?.id).toBe('initiator');
    expect(result.questions.map((item) => item.question)).toEqual([
      'Quem começa a conversa?',
      'Como você quer chamar o agente?',
      'Quer que ele sugira respostas estratégicas durante a conversa?',
      'Em que setor ele vende?',
      'Por qual canal?',
    ]);
    expect(misses).toHaveLength(0);
  });

  it('sem playbook, usa as perguntas do modelo e REGISTRA a lacuna', async () => {
    // O registro é a pauta do admin: sem ele, o papel sem ofício nasce genérico
    // e ninguém fica sabendo que faltou playbook.
    const { playbookRepository, policies, misses } = repositories([CORE, SALES]);
    const useCase = new PlanAgentBriefingUseCase({
      gateway: gatewayReturning({
        playbookKey: '',
        questions: [{ question: 'Que tipo de consulta ele agenda?', why: 'muda o fluxo' }],
      }),
      policies,
      playbooks: playbookRepository,
    });

    const result = await useCase.execute(CONTEXT, 'Recepcionista de clínica');

    expect(result.playbookKey).toBeNull();
    // Índice 3: iniciativa, nome e liga/desliga são fixas e vêm antes.
    expect(result.questions[3]?.question).toBe('Que tipo de consulta ele agenda?');
    expect(misses).toEqual(['Recepcionista de clínica']);
  });

  it('chave inventada pelo modelo é ignorada', async () => {
    // O modelo consegue produzir uma chave plausível que não existe. Aceitá-la
    // faria a tela anunciar um ofício que o sistema não tem.
    const { playbookRepository, policies, misses } = repositories([CORE, SALES]);
    const useCase = new PlanAgentBriefingUseCase({
      gateway: gatewayReturning({
        playbookKey: 'support.technical',
        questions: [{ question: 'Qual o sistema atendido?', why: 'muda o vocabulário' }],
      }),
      policies,
      playbooks: playbookRepository,
    });

    const result = await useCase.execute(CONTEXT, 'Suporte técnico');

    expect(result.playbookKey).toBeNull();
    expect(misses).toEqual(['Suporte técnico']);
  });

  it('o piso de conduta não é oferecido ao classificador', async () => {
    // Ele não é um papel entre outros. Visível no catálogo, viraria a escolha
    // preguiçosa quando nada mais coubesse — e o agente nasceria sem ofício.
    const { playbookRepository, policies } = repositories([CORE, SALES]);
    let instruction = '';

    const gateway = {
      generateStructured: async (
        _context: unknown,
        request: { blocks: Array<{ content: string }> },
      ) => {
        instruction = request.blocks.map((block) => block.content).join('\n');
        return {
          content: { playbookKey: '', questions: [] },
          raw: '',
          usage: {},
          model: 'fake',
          finishReason: 'stop',
          aiCallId: 'a',
          costMicros: 0,
          totalTokens: 0,
        };
      },
    } as unknown as LlmGateway;

    await new PlanAgentBriefingUseCase({
      gateway,
      policies,
      playbooks: playbookRepository,
    }).execute(CONTEXT, 'qualquer papel');

    expect(instruction).toContain('sales.consultive');
    expect(instruction).not.toContain('core.conduct');
  });
});

describe('tipo escolhido na tela', () => {
  /** Gateway que ACUSA se for chamado: o caminho curto não pode tocar no modelo. */
  const forbidden = {
    generateStructured: () => {
      throw new Error('o briefing não deveria chamar o modelo com o tipo já escolhido');
    },
  } as unknown as LlmGateway;

  it('não chama o modelo e devolve as perguntas curadas', async () => {
    // Classificação feita por uma PESSOA é melhor que por um modelo, e as
    // perguntas daquele ofício já estão escritas. Medido: 78s e falha pelo
    // caminho longo (três travadas do provider) contra 12ms por este.
    const { playbookRepository, policies, misses } = repositories([CORE, SALES]);

    const result = await new PlanAgentBriefingUseCase({
      gateway: forbidden,
      policies,
      playbooks: playbookRepository,
    }).execute(CONTEXT, 'Representante comercial consultivo', 'sales.consultive');

    expect(result.playbookLabel).toBe('Representante comercial consultivo');
    expect(result.totalTokens).toBe(0);
    expect(result.costMicros).toBe(0);
    expect(result.questions.map((item) => item.question)).toEqual([
      'Quem começa a conversa?',
      'Como você quer chamar o agente?',
      'Quer que ele sugira respostas estratégicas durante a conversa?',
      'Em que setor ele vende?',
      'Por qual canal?',
    ]);
    // Não é lacuna: o tipo existe e foi escolhido.
    expect(misses).toHaveLength(0);
  });

  it('o piso de conduta NUNCA vale como tipo escolhido', async () => {
    // Ele não é um papel e não tem perguntas próprias. Aceitá-lo aqui criaria
    // um agente sem ofício nenhum, por um clique.
    const { playbookRepository, policies } = repositories([CORE, SALES]);

    const result = await new PlanAgentBriefingUseCase({
      gateway: gatewayReturning({ playbookKey: '', questions: [] }),
      policies,
      playbooks: playbookRepository,
    }).execute(CONTEXT, 'qualquer coisa', 'core.conduct');

    expect(result.playbookKey).toBeNull();
  });
});
