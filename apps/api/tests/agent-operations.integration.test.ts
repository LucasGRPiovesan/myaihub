import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import type { PrismaAgentRepository } from '../src/modules/agents/infrastructure/prisma-agent.repository.js';
import { type MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
import { CONFIGURE_AGENT, CREATE_AGENT } from '../src/modules/myaihub/domain/agent-operations.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from '../src/modules/myaihub/infrastructure/master-policy.seed.js';
import type { PrismaHubConversationRepository } from '../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import type { UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import { createTestRunner } from './helpers/runner.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTAGT0000000000001';
const OTHER_ACCOUNT = '01ACCOUNTAGT0000000000002';
const USER_ID = '01USERAGT00000000000000001'.slice(0, 26);

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return {
    accountId,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/** O OS entendeu a fala como PERGUNTA: responde e não toca em nada. */
const ANSWER_OUTPUT = JSON.stringify({
  intent: 'ANSWER',
  interpretedIntent: 'O usuário perguntou se o agente já se adapta',
  rationale: 'Pergunta sobre a configuração existente, não pedido de mudança.',
  humanSummary:
    'Hoje não. A ST01 conduz um funil fixo em três tempos e nada manda pivotar quando o lead resiste.',
  mutations: [],
  conflicts: [],
  gaps: [],
});

const CREATE_OUTPUT = JSON.stringify({
  identity: { name: 'Philips', role: 'Representante Comercial Estratégico' },
  objective: 'Converter prestadores interessados em cadastros ativos na plataforma.',
  interpretedIntent: 'Criar um representante comercial consultivo',
  rationale: 'O usuário descreveu um vendedor consultivo, então estruturei skill e comunicação.',
  humanSummary: 'Criei o Philips como representante comercial consultivo.',
  mutations: [
    {
      kind: 'UPSERT_SKILL',
      semanticKey: 'skill.venda_consultiva',
      label: 'Venda consultiva',
      statement: 'Entende a necessidade antes de propor qualquer coisa.',
    },
    {
      kind: 'UPSERT_PERSONALITY_TRAIT',
      semanticKey: 'personality.paciente',
      label: 'Paciente',
      statement: 'Não apressa a decisão de quem está avaliando.',
    },
  ],
  conflicts: [],
  gaps: [],
});

describe.skipIf(!enabled)('Agentes — criação e parametrização (integração)', () => {
  const provider = new FakeProvider();

  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let agents: PrismaAgentRepository;
  let ids: UlidGenerator;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.createMany({
      data: [
        { id: ACCOUNT_ID, name: 'Conta Agentes', slug: 'conta-agentes' },
        { id: OTHER_ACCOUNT, name: 'Outra', slug: 'outra-agentes' },
      ],
    });
    await rawDb.user.create({
      data: { id: USER_ID, name: 'Op', email: 'op@exemplo.com', passwordHash: 'scrypt$x' },
    });

    provider.reset();

    const harness = createTestRunner(provider);
    runner = harness.runner;
    agents = harness.agents;
    conversations = harness.conversations;
    ids = harness.ids;

    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function conversation(scopeId: string | null = null) {
    return conversations.create(tenant(), {
      id: ids.generate(),
      scope: scopeId ? 'AGENT' : 'ROOT',
      scopeId,
      title: null,
    });
  }

  async function createAgent() {
    provider.reset();
    provider.script({ respond: CREATE_OUTPUT });
    const talk = await conversation();
    return runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um representante comercial que entenda a necessidade antes de vender.',
    });
  }

  // ------------------------------------------------------------------ criar
  it('cria um agente a partir de uma descrição em linguagem natural', async () => {
    const result = await createAgent();
    const found = await agents.findById(tenant(), result.entityId!);

    expect(found?.agent.name).toBe('Philips');
    expect(found?.agent.role).toBe('Representante Comercial Estratégico');
    expect(found?.version?.versionNumber).toBe(1);

    const config = found?.version?.canonicalConfig;
    expect(config?.objective.primary).toContain('cadastros ativos');
    expect(config?.skills).toHaveLength(1);
    expect(config?.skills[0]?.code).toBe('SK01');
    expect(config?.personality).toHaveLength(1);
    expect(config?.personality[0]?.code).toBe('PS01');
  });

  it('grava a cadeia de rastreabilidade da fala até a versão', async () => {
    const result = await createAgent();

    const change = await rawDb.configurationChange.findFirstOrThrow({
      where: { accountId: ACCOUNT_ID, entityType: 'AGENT', entityId: result.entityId! },
    });

    expect(change.hubMessageId).toBeTruthy();
    expect(change.hubOperationId).toBe(result.operationId);
    expect(change.toVersion).toBe(1);

    const message = await rawDb.hubMessage.findUniqueOrThrow({
      where: { id: change.hubMessageId! },
    });
    expect(message.content).toContain('representante comercial');
  });

  // ----------------------------------------------------------- parametrizar
  it('refina item existente em vez de duplicar quando a ideia é a mesma', async () => {
    const created = await createAgent();
    const before = await agents.findById(tenant(), created.entityId!);
    const skillId = before?.version?.canonicalConfig.skills[0]?.id;

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Aprofundar a venda consultiva',
        rationale: 'É a mesma competência, então refinei o item existente.',
        humanSummary: 'Aprofundei a descrição da venda consultiva.',
        mutations: [
          {
            kind: 'UPSERT_SKILL',
            semanticKey: 'skill.venda_consultiva',
            label: 'Venda consultiva',
            statement: 'Descobre a dor principal e só então conecta o benefício relevante.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'A venda consultiva dele precisa ir mais fundo na dor.',
      targetId: created.entityId!,
    });

    const after = await agents.findById(tenant(), created.entityId!);

    // Um item só, com o MESMO id técnico — refinado, não duplicado (§5.1).
    expect(after?.version?.canonicalConfig.skills).toHaveLength(1);
    expect(after?.version?.canonicalConfig.skills[0]?.id).toBe(skillId);
    expect(after?.version?.canonicalConfig.skills[0]?.statement).toContain('dor principal');
    expect(after?.version?.versionNumber).toBe(2);
  });

  it('separa personalidade de comunicação — facetas distintas, itens distintos', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Tornar a comunicação objetiva',
        rationale: 'Objetividade é COMO ele se comunica, não como ele é.',
        humanSummary: 'Ajustei a comunicação para objetiva.',
        mutations: [
          {
            kind: 'UPSERT_COMMUNICATION_TRAIT',
            semanticKey: 'communication.objectivity',
            label: 'Objetividade',
            statement: 'Responde direto, sem introduções nem repetições.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Quero o Philips mais objetivo.',
      targetId: created.entityId!,
    });

    const config = (await agents.findById(tenant(), created.entityId!))?.version?.canonicalConfig;

    expect(config?.communication).toHaveLength(1);
    expect(config?.communication[0]?.code).toBe('CM01');
    // A personalidade não foi tocada: as facetas são independentes (§7).
    expect(config?.personality).toHaveLength(1);
    expect(config?.personality[0]?.semanticKey).toBe('personality.paciente');
  });

  it('corrige prefixo de semanticKey errado e avisa, em vez de descartar a ideia', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Adicionar limite',
        rationale: 'O usuário proibiu prometer prazo.',
        humanSummary: 'Adicionei o limite.',
        mutations: [
          {
            // Prefixo errado: deveria ser `limit.`
            kind: 'UPSERT_LIMIT',
            semanticKey: 'rule.prazo',
            label: 'Não promete prazo',
            statement: 'Nunca promete prazo de atendimento.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);
    const result = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele nunca pode prometer prazo.',
      targetId: created.entityId!,
    });

    const config = (await agents.findById(tenant(), created.entityId!))?.version?.canonicalConfig;

    // Erro de FORMA não descarta o CONTEÚDO: a chave é corrigida.
    expect(config?.limits).toHaveLength(1);
    expect(config?.limits[0]?.semanticKey).toBe('limit.prazo');

    const events = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
    });
    const codes = events.map((event) => (event.payload as { code?: string }).code);
    expect(codes).toContain('VALUE_ADJUSTED');
  });

  it('rebaixa a regra quando o checker não existe, sem descartar o conteúdo', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Adicionar regra verificável',
        rationale: 'O usuário pediu limite de perguntas.',
        humanSummary: 'ok',
        mutations: [
          {
            kind: 'UPSERT_HARD_RULE',
            semanticKey: 'hard_rule.inventada',
            label: 'Regra',
            statement: 'Regra qualquer.',
            enforcement: 'DETERMINISTIC',
            check: { name: 'checker_que_nao_existe', params: {} },
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);

    const result = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Cria uma regra.',
      targetId: created.entityId!,
    });

    const config = (await agents.findById(tenant(), created.entityId!))?.version?.canonicalConfig;
    const rule = config?.hardRules[0];

    // O checker é metadado; a regra é o que o usuário disse. Ela entra —
    // mas NUNCA como DETERMINISTIC, senão o painel exibiria "verificada em
    // código" para algo que nenhum código verifica (§6.1).
    expect(rule?.statement).toBe('Regra qualquer.');
    expect(rule?.enforcement).toBe('HARD');
    expect(rule?.check).toBeUndefined();

    const events = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
    });
    const codes = events.map((event) => (event.payload as { code?: string }).code);
    expect(codes).toContain('VALUE_ADJUSTED');
  });

  it('rebaixa a regra quando o checker existe mas os params não servem', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Limitar perguntas',
        rationale: 'O usuário pediu.',
        humanSummary: 'ok',
        mutations: [
          {
            kind: 'UPSERT_HARD_RULE',
            semanticKey: 'hard_rule.perguntas',
            label: 'Uma pergunta por vez',
            statement: 'Faça no máximo uma pergunta por mensagem.',
            enforcement: 'DETERMINISTIC',
            // `max` é obrigatório: sem ele o checker estouraria ao rodar.
            check: { name: 'max_questions_per_message', params: {} },
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);

    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Uma pergunta por mensagem.',
      targetId: created.entityId!,
    });

    const config = (await agents.findById(tenant(), created.entityId!))?.version?.canonicalConfig;
    expect(config?.hardRules[0]?.enforcement).toBe('HARD');
    expect(config?.hardRules[0]?.check).toBeUndefined();
  });

  it('promove a DETERMINISTIC quando o modelo dá um checker válido com rótulo errado', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Limitar perguntas',
        rationale: 'O usuário pediu.',
        humanSummary: 'ok',
        mutations: [
          {
            kind: 'UPSERT_HARD_RULE',
            semanticKey: 'hard_rule.perguntas',
            label: 'Uma pergunta por vez',
            statement: 'Faça no máximo uma pergunta por mensagem.',
            // Rótulo errado, checker certo: quem sabe COMO verificar, verifica.
            enforcement: 'SOFT',
            check: { name: 'max_questions_per_message', params: { max: 1 } },
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);

    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Uma pergunta por mensagem.',
      targetId: created.entityId!,
    });

    const config = (await agents.findById(tenant(), created.entityId!))?.version?.canonicalConfig;
    expect(config?.hardRules[0]?.enforcement).toBe('DETERMINISTIC');
    expect(config?.hardRules[0]?.check).toEqual({
      name: 'max_questions_per_message',
      params: { max: 1 },
    });
  });

  it('aceita DETERMINISTIC quando o checker existe no registry', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Limitar perguntas por mensagem',
        rationale: 'Regra mecanicamente verificável.',
        humanSummary: 'ok',
        mutations: [
          {
            kind: 'UPSERT_HARD_RULE',
            semanticKey: 'hard_rule.uma_pergunta',
            label: 'Uma pergunta por vez',
            statement: 'Faz no máximo uma pergunta por mensagem.',
            enforcement: 'DETERMINISTIC',
            check: { name: 'max_questions_per_message', params: { max: 1 } },
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Uma pergunta por mensagem, no máximo.',
      targetId: created.entityId!,
    });

    const config = (await agents.findById(tenant(), created.entityId!))?.version?.canonicalConfig;
    expect(config?.hardRules[0]?.enforcement).toBe('DETERMINISTIC');
    expect(config?.hardRules[0]?.check?.name).toBe('max_questions_per_message');
  });

  it('preserva a versão anterior a cada ajuste', async () => {
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Ajustar objetivo',
        rationale: 'O usuário redefiniu o objetivo.',
        humanSummary: 'ok',
        mutations: [{ kind: 'SET_AGENT_OBJECTIVE', primary: 'Objetivo revisado.' }],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Muda o objetivo.',
      targetId: created.entityId!,
    });

    const versions = await agents.listVersions(tenant(), created.entityId!, 10);

    expect(versions).toHaveLength(2);
    // A v1 continua intacta: histórico não se reescreve (§18).
    expect(versions[1]?.canonicalConfig.objective.primary).toContain('cadastros ativos');
    expect(versions[0]?.canonicalConfig.objective.primary).toBe('Objetivo revisado.');
  });

  it('não grava versão quando o ajuste devolve o texto que já estava lá', async () => {
    // O caso medido em produção: o modelo re-emite o MESMO `statement` mudando
    // só a justificativa, o runner gravava versão nova assim mesmo, e o painel
    // anunciava "ajustei". O usuário testava, via o mesmo comportamento, e não
    // tinha como saber que nada tinha mudado.
    const created = await createAgent();

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Reforçar a venda consultiva',
        rationale: 'O usuário pediu mais firmeza na skill.',
        humanSummary: 'Reforcei a skill de venda consultiva.',
        mutations: [
          {
            kind: 'UPSERT_SKILL',
            semanticKey: 'skill.venda_consultiva',
            label: 'Venda consultiva',
            // Idêntico ao que a criação gravou.
            statement: 'Entende a necessidade antes de propor qualquer coisa.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation(created.entityId!);
    const resultado = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele ainda não está entendendo a necessidade antes de propor.',
      targetId: created.entityId!,
    });

    const versions = await agents.listVersions(tenant(), created.entityId!, 10);
    expect(versions).toHaveLength(1);
    // E o usuário é informado — em vez de receber uma versão nova silenciosa.
    expect(resultado.toVersion).toBeUndefined();
    expect(resultado.humanSummary).toContain('Não mudei nada');
  });

  // -------------------------------------------------------------- o ensaio
  //
  // O S.O passou a RODAR o agente que acabou de configurar, com a mesma fala
  // que produziu a queixa, antes de dizer que está pronto. Sem isso, quem
  // descobria se a correção pegou era o usuário — no teste seguinte, de graça
  // para o sistema e caro para ele.
  it('ensaia o agente depois de ajustar e conta o resultado', async () => {
    const ensaios: Array<{ agentId: string; rules: number }> = [];
    const harness = createTestRunner(provider, {
      rehearse: async (_context, entrada) => {
        ensaios.push({ agentId: entrada.agentId, rules: entrada.rules.length });
        return {
          status: 'PASSED',
          reply: 'E me conta, como os projetos costumam chegar até você?',
          evidence: '',
          costMicros: 12,
          totalTokens: 300,
        };
      },
    });

    provider.reset();
    provider.script({ respond: CREATE_OUTPUT });
    const inicio = await harness.conversations.create(tenant(), {
      id: harness.ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    const criado = await harness.runner.run(tenant(), {
      conversationId: inicio.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um representante comercial consultivo.',
    });

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Proibir pergunta sobre microdetalhe operacional',
        rationale: 'O usuário mostrou o agente perguntando como ele organiza o tempo.',
        humanSummary: 'Ajustei a SK01.',
        mutations: [
          {
            kind: 'UPSERT_SKILL',
            semanticKey: 'skill.venda_consultiva',
            label: 'Venda consultiva',
            statement:
              'Entende a necessidade antes de propor qualquer coisa. NUNCA pergunta como a ' +
              'pessoa organiza o próprio tempo nem detalhe de rotina interna: pergunta como ' +
              'os trabalhos chegam até ela.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await harness.conversations.create(tenant(), {
      id: harness.ids.generate(),
      scope: 'AGENT',
      scopeId: criado.entityId!,
      title: null,
    });
    const ajuste = await harness.runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele perguntou como eu organizo meu tempo. Isso é irrelevante.',
      targetId: criado.entityId!,
      testTranscript: [
        { role: 'user', content: 'De FullStack em uma consultoria' },
        { role: 'assistant', content: 'E como você organiza seu tempo para dar conta?' },
      ],
    });

    // Ensaiou o agente certo, com a regra que acabou de escrever na mão.
    expect(ensaios).toHaveLength(1);
    expect(ensaios[0]?.agentId).toBe(criado.entityId);
    expect(ensaios[0]?.rules).toBeGreaterThan(0);
    expect(ajuste.rehearsal?.status).toBe('PASSED');
    expect(ajuste.humanSummary).toContain('Testei com a mesma conversa');
  });

  it('quando o ensaio reprova, o painel diz que o erro CONTINUA', async () => {
    // O contrário de "ajustei": é aqui que o sistema para de prometer o que
    // não cumpriu. O usuário fica sabendo antes de testar de novo — e com a
    // frase que o agente disse, não com um adjetivo.
    const harness = createTestRunner(provider, {
      rehearse: async () => ({
        status: 'FAILED',
        reply: 'E quantas horas por dia você costuma dedicar a cada projeto?',
        evidence: 'quantas horas por dia você costuma dedicar',
        costMicros: 20,
        totalTokens: 400,
      }),
    });

    provider.reset();
    provider.script({ respond: CREATE_OUTPUT });
    const inicio = await harness.conversations.create(tenant(), {
      id: harness.ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    const criado = await harness.runner.run(tenant(), {
      conversationId: inicio.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um representante comercial consultivo.',
    });

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Evitar microdetalhe',
        rationale: 'Reforço da skill.',
        humanSummary: 'Ajustei a SK01.',
        mutations: [
          {
            kind: 'UPSERT_SKILL',
            semanticKey: 'skill.venda_consultiva',
            label: 'Venda consultiva',
            statement:
              'Entende a necessidade antes de propor qualquer coisa, sem entrar em ' +
              'microdetalhe operacional da rotina de quem está do outro lado.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await harness.conversations.create(tenant(), {
      id: harness.ids.generate(),
      scope: 'AGENT',
      scopeId: criado.entityId!,
      title: null,
    });
    const ajuste = await harness.runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele continua entrando em detalhe operacional.',
      targetId: criado.entityId!,
      testTranscript: [
        { role: 'user', content: 'De FullStack em uma consultoria' },
        { role: 'assistant', content: 'E como você organiza seu tempo?' },
      ],
    });

    expect(ajuste.rehearsal?.status).toBe('FAILED');
    expect(ajuste.humanSummary).toContain('o erro CONTINUA');
    // A frase do agente vai junto: é a evidência que o usuário precisa para
    // dizer o que ele DEVERIA ter perguntado.
    expect(ajuste.humanSummary).toContain('quantas horas por dia');
  });

  it('reprovado no ensaio, corrige de novo — e entrega só depois de passar', async () => {
    // "Só finalizar após constatar que o agente foi calibrado": a primeira
    // falha é informação nova (o modelo escreveu a regra sem saber como o
    // agente responderia), e é ela que entra no contexto da segunda rodada.
    const vereditos: Array<'FAILED' | 'PASSED'> = ['FAILED', 'PASSED'];
    let ensaios = 0;

    const harness = createTestRunner(provider, {
      rehearse: async () => {
        const veredito = vereditos[ensaios] ?? 'PASSED';
        ensaios += 1;
        return veredito === 'FAILED'
          ? {
              status: 'FAILED' as const,
              reply: 'E quantas horas por dia você dedica a cada projeto?',
              evidence: 'quantas horas por dia',
              costMicros: 10,
              totalTokens: 200,
            }
          : {
              status: 'PASSED' as const,
              reply: 'E como os projetos costumam chegar até você?',
              evidence: '',
              costMicros: 10,
              totalTokens: 200,
            };
      },
    });

    provider.reset();
    provider.script({ respond: CREATE_OUTPUT });
    const inicio = await harness.conversations.create(tenant(), {
      id: harness.ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    const criado = await harness.runner.run(tenant(), {
      conversationId: inicio.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um representante comercial consultivo.',
    });

    // A segunda rodada responde DIFERENTE — e responde diferente porque o
    // runner pôs a resposta reprovada no contexto dela. É esse bloco que o
    // dublê procura para saber em qual rodada está.
    provider.reset();
    provider.script({
      respond: (request) => {
        const viuAFalha = request.systemInstruction.includes('ELA NÃO PEGOU');
        return JSON.stringify({
          interpretedIntent: 'Proibir microdetalhe operacional',
          rationale: 'O agente perguntou sobre a rotina interna do interlocutor.',
          humanSummary: 'Ajustei a SK01.',
          mutations: [
            {
              kind: 'UPSERT_SKILL',
              semanticKey: 'skill.venda_consultiva',
              label: 'Venda consultiva',
              statement: viuAFalha
                ? 'Entende a necessidade antes de propor qualquer coisa. NUNCA pergunta ' +
                  'quantas horas a pessoa dedica a um projeto, como ela organiza o tempo, ' +
                  'nem qualquer detalhe da rotina interna dela: no lugar disso, pergunta ' +
                  'COMO OS TRABALHOS CHEGAM até ela e se ela quer pegar trabalho extra.'
                : 'Entende a necessidade antes de propor qualquer coisa, sem entrar em ' +
                  'microdetalhe operacional.',
            },
          ],
          conflicts: [],
          gaps: [],
        });
      },
    });

    const talk = await harness.conversations.create(tenant(), {
      id: harness.ids.generate(),
      scope: 'AGENT',
      scopeId: criado.entityId!,
      title: null,
    });
    const ajuste = await harness.runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele continua perguntando detalhe da minha rotina.',
      targetId: criado.entityId!,
      testTranscript: [
        { role: 'user', content: 'Sou FullStack numa consultoria' },
        { role: 'assistant', content: 'E como você organiza seu tempo?' },
      ],
    });

    // Duas rodadas de ensaio, e o que o usuário lê é o veredito FINAL.
    expect(ensaios).toBe(2);
    expect(ajuste.rehearsal?.status).toBe('PASSED');
    expect(ajuste.humanSummary).toContain('o erro não se repetiu');
  });

  // ------------------------------------------------------------ isolamento
  it('não enxerga agente de outra conta', async () => {
    const created = await createAgent();
    await expect(agents.findById(tenant(OTHER_ACCOUNT), created.entityId!)).resolves.toBeNull();
  });
});

// --------------------------------------------------------------- conversar
describe.skipIf(!enabled)('Agentes — o painel também conversa (integração)', () => {
  const provider = new FakeProvider();

  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let agents: PrismaAgentRepository;
  let ids: UlidGenerator;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.create({
      data: { id: ACCOUNT_ID, name: 'Conta Conversa', slug: 'conta-conversa' },
    });
    await rawDb.user.create({
      data: { id: USER_ID, name: 'Op', email: 'op@exemplo.com', passwordHash: 'scrypt$x' },
    });

    provider.reset();
    const harness = createTestRunner(provider);
    runner = harness.runner;
    agents = harness.agents;
    conversations = harness.conversations;
    ids = harness.ids;
    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function agentWithConfig() {
    provider.reset();
    provider.script({ respond: CREATE_OUTPUT });
    const start = await conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    return runner.run(tenant(), {
      conversationId: start.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um representante comercial consultivo.',
    });
  }

  it('pergunta sobre o agente é respondida sem alterar a configuração', async () => {
    const created = await agentWithConfig();
    const agentId = created.entityId!;
    const before = await agents.findById(tenant(), agentId);

    provider.reset();
    provider.script({ respond: ANSWER_OUTPUT });

    const talk = await conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'AGENT',
      scopeId: agentId,
      title: null,
    });

    const result = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele já é capaz de se adaptar estrategicamente quando for necessário?',
      targetId: agentId,
    });

    // A resposta chega ao usuário...
    expect(result.humanSummary).toContain('ST01');
    // ...e nada foi tocado: nem versão nova, nem entidade no resultado.
    expect(result.entityId).toBeUndefined();
    expect(result.toVersion).toBeUndefined();

    const after = await agents.findById(tenant(), agentId);
    expect(after?.version?.versionNumber).toBe(before?.version?.versionNumber);
    expect(after?.version?.canonicalConfig).toEqual(before?.version?.canonicalConfig);
  });

  it('a resposta entra no transcrito, para o OS lembrar do que já foi dito', async () => {
    const created = await agentWithConfig();

    provider.reset();
    provider.script({ respond: ANSWER_OUTPUT });

    const talk = await conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'AGENT',
      scopeId: created.entityId!,
      title: null,
    });
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_AGENT,
      userMessage: 'Ele já sabe mudar de abordagem?',
      targetId: created.entityId!,
    });

    const messages = await conversations.listMessages(tenant(), talk.id, 10);
    expect(messages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);

    // Nenhuma alteração foi registrada — a auditoria não pode inventar histórico.
    const changes = await rawDb.configurationChange.count({
      where: { accountId: ACCOUNT_ID, entityId: created.entityId! },
    });
    expect(changes).toBe(1);
  });
});
