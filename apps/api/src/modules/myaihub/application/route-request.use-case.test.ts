import { describe, expect, it, vi } from 'vitest';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import type { AccountInventory, AccountInventoryReader } from './account-inventory.js';
import { allOperations, RouteHubRequestUseCase, targetKindOf } from './route-request.use-case.js';
import { systemTenantContext } from '../../../shared/application/tenant-context.js';

/**
 * O S.O escolhe O QUE FAZER e SOBRE O QUÊ, em qualquer lugar do produto.
 *
 * Os dois casos que motivaram isto:
 *
 *   O usuário pediu "cria a campanha de estamparia" com o chip da tela em
 *   "refinar perfil". A operação rodou, não tinha como criar campanha nenhuma,
 *   e o modelo descreveu o que FARIA. A tela continuou vazia e a resposta
 *   parecia um "pronto" — nada falhou, e nada aconteceu.
 *
 *   E para ele entender que se falava de um projeto, era preciso NAVEGAR até o
 *   projeto. Um sistema operacional não pede que você abra a pasta certa antes
 *   de mandar copiar um arquivo.
 */

const context = systemTenantContext('teste de roteamento');

const SANKAR = '01SANKAR00000000000000000';
const OUTRO_PROJETO = '01OUTRO000000000000000000';
const ALEX = '01ALEX0000000000000000000';

const inventario: AccountInventory = {
  projects: [
    { id: SANKAR, name: 'Sankar', detail: 'projeto ativo' },
    { id: OUTRO_PROJETO, name: 'Nordeste', detail: 'projeto ativo' },
  ],
  agents: [{ id: ALEX, name: 'Alex', detail: 'Representante Comercial Estratégico' }],
  campaigns: [],
  playbooks: [{ id: 'sales.consultive', name: 'Venda consultiva', detail: 'ofício' }],
  knowledge: [],
};

const leitor = {
  read: vi.fn().mockResolvedValue(inventario),
} as unknown as AccountInventoryReader;

function gatewayQueDevolve(content: {
  operation?: string;
  targetId?: string;
  reason?: string;
  question?: string;
}): LlmGateway {
  return {
    generateStructured: vi.fn().mockResolvedValue({
      content: { operation: '', targetId: '', reason: '', question: '', ...content },
      costMicros: 12,
      totalTokens: 340,
    }),
  } as unknown as LlmGateway;
}

function router(gateway: LlmGateway): RouteHubRequestUseCase {
  return new RouteHubRequestUseCase({ gateway, inventory: leitor });
}

describe('roteamento do pedido', () => {
  it('troca a operação sugerida quando o pedido é de outra', async () => {
    const routed = await router(
      gatewayQueDevolve({
        operation: 'campaign.create',
        targetId: SANKAR,
        reason: 'Você quer criar a campanha de estamparia.',
      }),
    ).execute(context, {
      scope: 'PROJECT',
      scopeId: SANKAR,
      message: 'Estamparia, se baseie nas informações que te passei',
      suggested: 'project.refine_profile',
    });

    expect(routed.operation?.name).toBe('campaign.create');
    expect(routed.overridden).toBe(true);
    expect(routed.reason).toContain('estamparia');
  });

  it('age FORA da tela: pedir projeto estando no agente cria o projeto', async () => {
    // Era a limitação central. `project.create_from_brief` é escopo ROOT e a
    // conversa é AGENT — antes, a rota recusava com 422 por escopo diferente.
    const routed = await router(
      gatewayQueDevolve({
        operation: 'project.create_from_brief',
        reason: 'Você quer um projeto novo.',
      }),
    ).execute(context, {
      scope: 'AGENT',
      scopeId: ALEX,
      message: 'cria um projeto pra minha metalúrgica',
      suggested: 'agent.configure',
    });

    expect(routed.operation?.name).toBe('project.create_from_brief');
    // Operação que cria a partir do nada não recebe alvo: mandar o id do agente
    // faria o runner tentar carregar um projeto com ele.
    expect(routed.targetId).toBeUndefined();
  });

  it('resolve o alvo pelo NOME, não pela tela', async () => {
    const routed = await router(
      gatewayQueDevolve({ operation: 'project.organize_workspace', targetId: OUTRO_PROJETO }),
    ).execute(context, {
      scope: 'PROJECT',
      scopeId: SANKAR,
      message: 'o que falta no Nordeste?',
    });

    expect(routed.targetId).toBe(OUTRO_PROJETO);
  });

  it('id do TIPO ERRADO é descartado, e a tela assume', async () => {
    // O modelo devolveu o id de um AGENTE numa operação de projeto. Aceitar
    // faria o runner carregar nada e o usuário ler "item não encontrado", que
    // não diz nada sobre a causa.
    const routed = await router(
      gatewayQueDevolve({ operation: 'project.refine_profile', targetId: ALEX }),
    ).execute(context, {
      scope: 'PROJECT',
      scopeId: SANKAR,
      message: 'a gente também atende farmacêutica',
    });

    expect(routed.targetId).toBe(SANKAR);
  });

  it('id inventado é descartado', async () => {
    const routed = await router(
      gatewayQueDevolve({ operation: 'project.refine_profile', targetId: '01NAOEXISTE' }),
    ).execute(context, { scope: 'ROOT', message: 'muda alguma coisa' });

    expect(routed.targetId).toBeUndefined();
  });

  it('sem saber de qual entidade se fala, PERGUNTA em vez de adivinhar', async () => {
    // Adivinhar entre dois projetos significa reconfigurar o errado metade das
    // vezes, num documento que o usuário nem estava olhando.
    const routed = await router(
      gatewayQueDevolve({ question: 'Qual projeto: Sankar ou Nordeste?' }),
    ).execute(context, { scope: 'ROOT', message: 'organiza o projeto pra mim' });

    expect(routed.operation).toBeUndefined();
    expect(routed.question).toContain('Sankar');
  });

  it('confirmando a sugestão, não marca troca — o painel não avisa à toa', async () => {
    const routed = await router(
      gatewayQueDevolve({ operation: 'project.refine_profile', targetId: SANKAR }),
    ).execute(context, {
      scope: 'PROJECT',
      scopeId: SANKAR,
      message: 'A gente também atende indústria farmacêutica',
      suggested: 'project.refine_profile',
    });

    expect(routed.operation?.name).toBe('project.refine_profile');
    expect(routed.overridden).toBe(false);
  });

  it('nome de operação inventado cai na sugestão da tela', async () => {
    const routed = await router(gatewayQueDevolve({ operation: 'project.fazer_magica' })).execute(
      context,
      {
        scope: 'PROJECT',
        scopeId: SANKAR,
        message: 'qualquer coisa',
        suggested: 'project.refine_profile',
      },
    );

    expect(routed.operation?.name).toBe('project.refine_profile');
    expect(routed.overridden).toBe(false);
    expect(routed.reason).toBe('');
  });

  it('mensagem vazia não chama o modelo', async () => {
    // O usuário clicou uma ação e mandou sem escrever: a escolha dele é a
    // única informação que existe, e ela já está na sugestão.
    const gateway = gatewayQueDevolve({ operation: 'campaign.create' });
    const routed = await router(gateway).execute(context, {
      scope: 'PROJECT',
      scopeId: SANKAR,
      message: '   ',
      suggested: 'project.refine_profile',
    });

    expect(routed.operation?.name).toBe('project.refine_profile');
    expect(routed.costMicros).toBe(0);
    expect(gateway.generateStructured).not.toHaveBeenCalled();
  });

  it('AJUSTE sem alvo vira PERGUNTA — nunca uma criação indevida', async () => {
    // O runner trata "sem alvo" como CRIAÇÃO. Deixar passar faria um pedido de
    // ajuste criar um projeto NOVO, que o usuário só descobriria pela lista.
    const routed = await router(
      gatewayQueDevolve({ operation: 'project.refine_profile', targetId: '01NAOEXISTE' }),
    ).execute(context, { scope: 'ROOT', message: 'ajusta o perfil' });

    expect(routed.operation).toBeUndefined();
    expect(routed.question).toBeTruthy();
  });

  it('CRIAÇÃO nunca recebe alvo, nem quando o escopo dela tem tipo', () => {
    //  é escopo PLAYBOOK e cria. Resolvendo a chave de um
    // ofício existente, ele reescreveria o piso de todo agente daquele papel.
    const criar = allOperations().find((item) => item.name === 'playbook.create');
    expect(targetKindOf(criar!)).toBeNull();

    const calibrar = allOperations().find((item) => item.name === 'playbook.refine');
    expect(targetKindOf(calibrar!)).toBe('PLAYBOOK');
  });

  it('toda operação que AJUSTA declara requiresTarget', () => {
    // Operação nova sem isto vira uma criação silenciosa no primeiro pedido
    // que o roteador não conseguir resolver.
    const ajustam = ['refine', 'configure', 'organize'];
    for (const operation of allOperations()) {
      const eAjuste = ajustam.some((verbo) => operation.name.includes(verbo));
      if (eAjuste) expect(operation.requiresTarget, operation.name).toBe(true);
    }
  });

  it('toda operação declara para que serve', () => {
    // Sem `purpose` o roteador escolhe pelo `label`, que é progresso
    // ("Refinando o perfil do projeto") e não diz o que a operação PODE fazer.
    // Operação nova sem isto entra na lista muda e nunca é escolhida.
    for (const operation of allOperations()) {
      expect(operation.purpose, `${operation.name} sem purpose`).toBeTruthy();
    }
  });

  it('criar campanha espera o id do PROJETO, não o da campanha', () => {
    // `scopeIdRole: PARENT`. Confundir os dois faria o runner tentar carregar
    // uma campanha usando o id de um projeto.
    const criar = allOperations().find((item) => item.name === 'campaign.create');
    expect(targetKindOf(criar!)).toBe('PROJECT');

    const ajustar = allOperations().find((item) => item.name === 'campaign.refine_strategy');
    expect(targetKindOf(ajustar!)).toBe('CAMPAIGN');
  });
});

/*
  AÇÕES DO SISTEMA. O caso que motivou: "Vincula ele já no projeto Sankar", com
  o agente nomeado — e o S.O respondeu explicando onde clicar. A fronteira do
  S.O é a fronteira do sistema: o que a tela faz, ele faz.
*/
describe('ações do sistema', () => {
  const LINHA = '01LINHA000000000000000000';
  const ESTAMPARIA = '01ESTAMP00000000000000000';

  function comCampanhas(campanhas: AccountInventory['campaigns']): AccountInventoryReader {
    return {
      read: vi.fn().mockResolvedValue({ ...inventario, campaigns: campanhas }),
    } as unknown as AccountInventoryReader;
  }

  function roteador(content: Record<string, unknown>, campanhas: AccountInventory['campaigns']) {
    return new RouteHubRequestUseCase({
      gateway: gatewayQueDevolve(content as never),
      inventory: comCampanhas(campanhas),
    });
  }

  const linha = { id: LINHA, name: 'Linha Industrial Sankar', detail: 'DRAFT', parentId: SANKAR };

  it('vincular no PROJETO vira a campanha única dele', async () => {
    const routed = await roteador(
      { operation: 'campaign.bind_agent', targetId: SANKAR, secondaryId: ALEX },
      [linha],
    ).execute(context, { scope: 'AGENT', scopeId: ALEX, message: 'Vincula ele no projeto Sankar' });

    expect(routed.operation).toBeUndefined();
    expect(routed.action?.spec.name).toBe('campaign.bind_agent');
    expect(routed.action?.args).toMatchObject({
      targetId: LINHA,
      targetName: 'Linha Industrial Sankar',
      secondaryId: ALEX,
      secondaryName: 'Alex',
    });
  });

  it('"ele" sem id resolve pelo agente da tela', async () => {
    const routed = await roteador({ operation: 'campaign.bind_agent', targetId: LINHA }, [
      linha,
    ]).execute(context, { scope: 'AGENT', scopeId: ALEX, message: 'Vincula ele na Linha' });

    expect(routed.action?.args.secondaryId).toBe(ALEX);
  });

  it('projeto com várias campanhas vira pergunta citando as opções', async () => {
    const routed = await roteador(
      { operation: 'campaign.bind_agent', targetId: SANKAR, secondaryId: ALEX },
      [linha, { id: ESTAMPARIA, name: 'Estamparia', detail: 'DRAFT', parentId: SANKAR }],
    ).execute(context, { scope: 'ROOT', message: 'Vincula o Alex no Sankar' });

    expect(routed.action).toBeUndefined();
    expect(routed.question).toContain('Linha Industrial Sankar');
    expect(routed.question).toContain('Estamparia');
  });

  it('ação irreversível sem confirmação vira pergunta, não exclusão', async () => {
    const routed = await roteador({ operation: 'agent.delete', targetId: ALEX }, []).execute(
      context,
      { scope: 'ROOT', message: 'Exclui o Alex' },
    );

    expect(routed.action).toBeUndefined();
    expect(routed.question).toContain('Alex');
  });

  it('com a confirmação do turno anterior, a exclusão segue', async () => {
    const routed = await roteador(
      { operation: 'agent.delete', targetId: ALEX, confirmed: true },
      [],
    ).execute(context, { scope: 'ROOT', message: 'sim' });

    expect(routed.action?.spec.name).toBe('agent.delete');
  });

  it('ação de plataforma nem é oferecida a quem não é admin', async () => {
    const routed = await roteador(
      { operation: 'model.set_route', targetId: 'hub.fast', value: 'gemini:x' },
      [],
    ).execute({ ...context, role: 'USER' }, { scope: 'ROOT', message: 'troca o modelo' });

    expect(routed.action).toBeUndefined();
  });

  it('id inventado não vira ação', async () => {
    const routed = await roteador(
      { operation: 'campaign.publish', targetId: '01INVENTADO00000000000000' },
      [linha, { id: ESTAMPARIA, name: 'Estamparia', detail: 'DRAFT', parentId: SANKAR }],
    ).execute(context, { scope: 'ROOT', message: 'publica' });

    expect(routed.action).toBeUndefined();
    expect(routed.question).toBeTruthy();
  });

  it('a instrução do roteador é essencial — cortada, ele decide cego', async () => {
    const gateway = gatewayQueDevolve({ operation: 'campaign.bind_agent' });
    await new RouteHubRequestUseCase({ gateway, inventory: comCampanhas([linha]) }).execute(
      context,
      { scope: 'CAMPAIGN', scopeId: LINHA, message: 'vincula o agente' },
    );

    const pedido = vi.mocked(gateway.generateStructured).mock.calls[0]![1];
    expect(pedido.blocks.every((item) => item.essential)).toBe(true);
  });

  it('UM agente só na conta: "o agente criado" é ele, sem pergunta', async () => {
    // O caso real: na tela da campanha, "vincule o agente criado aqui" virou
    // "qual é o identificador do agente?" — numa conta com um agente só.
    const routed = await roteador({ operation: 'campaign.bind_agent' }, [linha]).execute(context, {
      scope: 'CAMPAIGN',
      scopeId: LINHA,
      message: 'Vincule o agente criado aqui no projeto',
    });

    expect(routed.question).toBeUndefined();
    expect(routed.action?.args).toMatchObject({ targetId: LINHA, secondaryId: ALEX });
  });

  it('operação de ajuste com UM candidato não pergunta qual', async () => {
    const routed = await roteador({ operation: 'agent.configure' }, []).execute(context, {
      scope: 'ROOT',
      message: 'deixa o agente mais objetivo',
    });

    expect(routed.targetId).toBe(ALEX);
  });
});

describe('apelidos do inventário', () => {
  it('o roteador lê apelidos curtos e o código os traduz de volta para id', async () => {
    const gateway = gatewayQueDevolve({ operation: 'project.organize_workspace', targetId: 'p2' });
    const routed = await new RouteHubRequestUseCase({ gateway, inventory: leitor }).execute(
      context,
      { scope: 'ROOT', message: 'o que falta no Nordeste?' },
    );

    // Minúsculo de propósito: o modelo às vezes muda a caixa.
    expect(routed.targetId).toBe(OUTRO_PROJETO);

    const instrucao = vi.mocked(gateway.generateStructured).mock.calls[0]![1].blocks[0]!.content;
    expect(instrucao).toContain('P2 Nordeste');
    // Id de 26 caracteres não entra no prompt do roteador.
    expect(instrucao).not.toContain(OUTRO_PROJETO);
  });
});

describe('ação sobre um tipo que a conta não tem', () => {
  it('"crie um projeto a partir deste link" numa conta vazia é CRIAÇÃO, não "qual projeto?"', async () => {
    // A regressão real: o link na frase levou o modelo a escolher cadastrar a
    // página no conhecimento de um projeto — numa conta sem projeto nenhum.
    const vazia = {
      read: vi.fn().mockResolvedValue({ ...inventario, projects: [], agents: [], campaigns: [] }),
    } as unknown as AccountInventoryReader;
    const routed = await new RouteHubRequestUseCase({
      gateway: gatewayQueDevolve({
        operation: 'knowledge.add_url',
        value: 'https://www.sankar.com.br/home',
      } as never),
      inventory: vazia,
    }).execute(context, {
      scope: 'ROOT',
      message: 'Crie um projeto a partir do portal da empresa: https://www.sankar.com.br/home',
    });

    expect(routed.question).toBeUndefined();
    expect(routed.operation?.name).toBe('project.create_from_brief');
  });
});
