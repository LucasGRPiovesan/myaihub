import { agentPlaybookSchema, type AgentPlaybook } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import { systemTenantContext } from '../../../shared/application/tenant-context.js';
import type { PolicyRepository } from '../domain/repositories.js';
import { RevisePlaybookUseCase } from './revise-playbook.use-case.js';

const CONTEXT = systemTenantContext('teste');

const CURRENT: AgentPlaybook = agentPlaybookSchema.parse({
  key: 'sales.consultive',
  label: 'Representante comercial consultivo',
  appliesTo: ['vendedor'],
  thesis: 'Entende antes de propor, e não empurra nada para ninguém em nenhum momento.',
  principles: [
    {
      code: 'PR01',
      semanticKey: 'skill.diagnose',
      label: 'Diagnostica antes',
      facet: 'skills',
      statement: 'Diagnostica antes de propor qualquer coisa a quem está do outro lado.',
    },
    {
      code: 'PR02',
      semanticKey: 'personality.autonomy',
      label: 'Preserva a autonomia',
      facet: 'personality',
      statement: 'Preserva a autonomia de quem está do outro lado e aceita o não.',
    },
    {
      code: 'PR03',
      semanticKey: 'communication.short',
      label: 'Escreve curto',
      facet: 'communication',
      statement: 'Escreve curto e direto, uma ideia por mensagem, sem preâmbulo nenhum.',
    },
  ],
  antiPatterns: [
    {
      code: 'LM01',
      semanticKey: 'limit.no_invented_facts',
      label: 'Nada inventado',
      statement: 'Inventar preço ou prazo que não estejam no contexto.',
    },
  ],
});

const policies: PolicyRepository = {
  getCurrent: async () => null,
  ensureSeeded: async () => ({ id: 'x', versionNumber: 1, sections: {} }),
  syncSections: async () => ({
    version: { id: 'x', versionNumber: 1, sections: {} },
    added: [],
    updated: [],
  }),
};

function gatewayReturning(content: unknown): { gateway: LlmGateway; sent: () => string } {
  let blocks = '';
  const gateway = {
    generateStructured: async (
      _context: unknown,
      request: { blocks: Array<{ content: string }> },
    ) => {
      blocks = request.blocks.map((block) => block.content).join('\n');
      return {
        content,
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

  return { gateway, sent: () => blocks };
}

describe('o OS calibrando um playbook', () => {
  it('mexe SÓ no que foi pedido; o resto sai byte por byte igual', async () => {
    // É a razão de existir da mutação tipada. A versão anterior pedia o
    // documento inteiro de volta e o modelo preservou 14 de 15 princípios —
    // e o item perdido ninguém teria como descobrir.
    const { gateway } = gatewayReturning({
      summary: 'Reforcei a autonomia e criei o limite de insistência.',
      mutations: [
        {
          kind: 'UPSERT_PRINCIPLE',
          semanticKey: 'personality.autonomy',
          facet: 'personality',
          label: 'Preserva a autonomia',
          statement:
            'Aceita "não" e "agora não" na primeira vez, sem reformular o mesmo pedido com ' +
            'outras palavras nem tentar dobrar a resistência.',
        },
        {
          kind: 'UPSERT_LIMIT',
          semanticKey: 'limit.no_insisting',
          label: 'Nada de insistir',
          statement: 'Insistir depois de uma recusa clara.',
        },
      ],
    });

    const result = await new RevisePlaybookUseCase({ gateway, policies }).execute(CONTEXT, {
      playbook: CURRENT,
      instruction: 'ele insiste demais depois do não',
    });

    // O princípio que ninguém citou continua idêntico.
    expect(result.playbook.principles[0]).toEqual(CURRENT.principles[0]);
    // O citado foi refinado NO LUGAR: mesmo código, mesma posição.
    expect(result.playbook.principles[1]?.code).toBe('PR02');
    expect(result.playbook.principles[1]?.statement).toContain('agora não');
    expect(result.playbook.principles).toHaveLength(3);
    // O limite novo entrou com código próprio, sem tocar no que existia.
    expect(result.playbook.antiPatterns.map((item) => item.code)).toEqual(['LM01', 'LM02']);
    expect(result.applied).toHaveLength(2);
  });

  it('a CHAVE do playbook nunca é alvo de mutação', async () => {
    // Não existe mutação que troque a chave, e é de propósito: chave trocada
    // apontaria o playbook para o nada — o agente já criado guarda a antiga.
    const { gateway } = gatewayReturning({
      summary: 'ok',
      mutations: [{ kind: 'SET_PLAYBOOK_IDENTITY', label: 'Outro nome' }],
    });

    const result = await new RevisePlaybookUseCase({ gateway, policies }).execute(CONTEXT, {
      playbook: CURRENT,
      instruction: 'renomeia',
    });

    expect(result.playbook.key).toBe('sales.consultive');
    expect(result.playbook.label).toBe('Outro nome');
  });

  it('remoção de item inexistente é REJEITADA, não silenciada', async () => {
    // Silenciar esconderia um erro de leitura do modelo: ele achou que existia
    // um item que não existe, e o admin merece saber disso.
    const { gateway } = gatewayReturning({
      summary: 'tirei',
      mutations: [{ kind: 'REMOVE_PRINCIPLE', semanticKey: 'skill.que_nao_existe' }],
    });

    const result = await new RevisePlaybookUseCase({ gateway, policies }).execute(CONTEXT, {
      playbook: CURRENT,
      instruction: 'tira aquele princípio',
    });

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('não existe');
    expect(result.playbook.principles).toHaveLength(3);
  });

  it('manda os CÓDIGOS e CHAVES atuais — sem eles o modelo duplica em vez de refinar', async () => {
    const { gateway, sent } = gatewayReturning({
      summary: 'ok',
      mutations: [{ kind: 'SET_SOURCES', items: ['uma fonte'] }],
    });

    await new RevisePlaybookUseCase({ gateway, policies }).execute(CONTEXT, {
      playbook: CURRENT,
      instruction: 'qualquer coisa',
    });

    expect(sent()).toContain('[PR01] skill.diagnose');
    expect(sent()).toContain('VOCÊ NÃO REESCREVE O DOCUMENTO');
    expect(sent()).toContain('REFINAR É REUTILIZAR A `semanticKey`');
  });
});
