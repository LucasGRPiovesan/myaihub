import { PendingAdherence } from '../src/modules/conversations/application/pending-adherence.js';
import { SILENT_LOGGER } from './helpers/runner.js';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import { TestAgentUseCase } from '../src/modules/agents/application/test-agent.use-case.js';
import { compileAgentPrompt } from '../src/modules/agents/domain/agent-prompt.js';
import type { PrismaAgentRepository } from '../src/modules/agents/infrastructure/prisma-agent.repository.js';
import type { MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
import { CREATE_AGENT } from '../src/modules/myaihub/domain/agent-operations.js';
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

const ACCOUNT_ID = '01ACCOUNTENG0000000000001';
const USER_ID = '01USERENG00000000000000001'.slice(0, 26);

function tenant(): TenantContext {
  return {
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/** O usuário disse, no briefing, que quem abre a conversa é o agente. */
const CREATE_WITH_INITIATIVE = JSON.stringify({
  identity: { name: 'Vera', role: 'Recepcionista Ativa' },
  objective: 'Receber quem chega e descobrir o motivo do contato.',
  interpretedIntent: 'Criar uma recepcionista que aborda primeiro',
  rationale: 'O usuário disse que o agente puxa o assunto, então derivei a abertura.',
  humanSummary: 'Criei a Vera. Ela abre a conversa.',
  mutations: [
    {
      kind: 'SET_AGENT_ENGAGEMENT',
      initiator: 'AGENT',
      openerMode: 'SCRIPTED',
      opener: 'Oi! Sou a Vera. Me conta o que te trouxe aqui hoje?',
    },
    {
      kind: 'UPSERT_BEHAVIOR',
      semanticKey: 'behavior.abertura',
      label: 'Abre sem despejar',
      statement: 'Cumprimenta em uma frase e faz uma pergunta, sem listar serviços de cara.',
    },
  ],
  conflicts: [],
  gaps: [],
});

describe.skipIf(!enabled)('Quem abre a conversa (integração)', () => {
  const provider = new FakeProvider();

  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let agents: PrismaAgentRepository;
  let ids: UlidGenerator;
  let harness: ReturnType<typeof createTestRunner>;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.create({
      data: { id: ACCOUNT_ID, name: 'Conta Engajamento', slug: 'conta-engajamento' },
    });
    await rawDb.user.create({
      data: { id: USER_ID, name: 'Op', email: 'op@exemplo.com', passwordHash: 'scrypt$x' },
    });

    provider.reset();
    harness = createTestRunner(provider);
    runner = harness.runner;
    agents = harness.agents;
    conversations = harness.conversations;
    ids = harness.ids;
    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function createAgent(): Promise<string> {
    provider.reset();
    provider.script({ respond: CREATE_WITH_INITIATIVE });
    const talk = await conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    const result = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_AGENT,
      userMessage:
        'Quero uma recepcionista. Quem começa a conversa é o AGENTE: ela puxa o assunto sozinha.',
    });
    return result.entityId!;
  }

  it('a iniciativa declarada no briefing entra no canônico', async () => {
    const agentId = await createAgent();
    const found = await agents.findById(tenant(), agentId);

    expect(found?.version?.canonicalConfig.engagement.initiator).toBe('AGENT');
    expect(found?.version?.canonicalConfig.engagement.opener).toContain('Vera');
  });

  it('o prompt do runtime manda o agente abrir, e cedo', async () => {
    const agentId = await createAgent();
    const found = await agents.findById(tenant(), agentId);
    const prompt = compileAgentPrompt({ agent: found!.version!.canonicalConfig });

    expect(prompt).toContain('VOCÊ ABRE A CONVERSA');
    // Antes das facetas: instrução de abertura no rodapé perde força quando o
    // contexto cresce.
    expect(prompt.indexOf('VOCÊ ABRE A CONVERSA')).toBeLessThan(
      prompt.indexOf('COMO VOCÊ CONDUZ A CONVERSA'),
    );
  });

  it('abertura por ROTEIRO não gasta token: o texto já está no canônico', async () => {
    const agentId = await createAgent();
    const testAgent = new TestAgentUseCase({
      pending: new PendingAdherence(),
      logger: SILENT_LOGGER,
      agents: harness.agents,
      campaigns: harness.campaigns,
      projects: harness.projects,
      brands: harness.brands,
      knowledge: harness.knowledgeRepo,
      retriever: harness.retriever,
      conversations: harness.conversationService,
      adherence: harness.adherence,
      gateway: harness.gateway,
    });

    provider.reset();
    // Nenhum script: se o caso de uso chamasse o provider, isto falharia.
    const opening = await testAgent.open(tenant(), agentId);

    expect(opening.reply).toContain('Vera');
    expect(opening.totalTokens).toBe(0);
    expect(opening.costMicros).toBe(0);
  });

  it('abertura ADAPTATIVA nunca devolve o campo verbatim como se fosse fala', async () => {
    provider.reset();
    provider.script({
      respond: JSON.stringify({
        identity: { name: 'Ana', role: 'Recepcionista' },
        objective: 'Receber quem chega.',
        interpretedIntent: 'O exemplo era ilustração de tom',
        rationale: 'O usuário deu um exemplo, não pediu roteiro.',
        humanSummary: 'Criei a Ana.',
        mutations: [
          {
            kind: 'SET_AGENT_ENGAGEMENT',
            initiator: 'AGENT',
            openerMode: 'ADAPTIVE',
            openerGuidance: 'Cumprimenta, se apresenta e pede o nome antes do assunto.',
            opener: 'Olá! Tudo bem? Sou a Ana.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    const created = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_AGENT,
      userMessage: 'Recepcionista que abre a conversa. ex: "Olá! Tudo bem? Sou a Ana."',
    });

    const testAgent = new TestAgentUseCase({
      pending: new PendingAdherence(),
      logger: SILENT_LOGGER,
      agents: harness.agents,
      campaigns: harness.campaigns,
      projects: harness.projects,
      brands: harness.brands,
      knowledge: harness.knowledgeRepo,
      retriever: harness.retriever,
      conversations: harness.conversationService,
      adherence: harness.adherence,
      gateway: harness.gateway,
    });

    provider.reset();
    provider.script({ respond: 'Oi, boa tarde! Sou a Ana. Como posso te chamar?' });
    const opening = await testAgent.open(tenant(), created.entityId!);

    // O modelo formulou a abertura — o campo `opener` era só referência de tom.
    expect(opening.reply).not.toBe('Olá! Tudo bem? Sou a Ana.');
    expect(opening.totalTokens).toBeGreaterThan(0);
  });
  it('o cenário do laboratório chega ao prompt do agente', async () => {
    const agentId = await createAgent();
    const testAgent = new TestAgentUseCase({
      pending: new PendingAdherence(),
      logger: SILENT_LOGGER,
      agents: harness.agents,
      campaigns: harness.campaigns,
      projects: harness.projects,
      brands: harness.brands,
      knowledge: harness.knowledgeRepo,
      retriever: harness.retriever,
      conversations: harness.conversationService,
      adherence: harness.adherence,
      gateway: harness.gateway,
    });

    provider.reset();
    const opening = await testAgent.open(tenant(), agentId, {
      scenario: 'Clínica odontológica em Curitiba, contato por WhatsApp.',
    });

    expect(opening.systemPrompt).toContain('A SITUAÇÃO EM QUE VOCÊ ESTÁ');
    expect(opening.systemPrompt).toContain('Curitiba');
  });

  it('agente que responde quando abordado não recebe instrução de abrir', async () => {
    provider.reset();
    provider.script({
      respond: JSON.stringify({
        identity: { name: 'Caio', role: 'Suporte' },
        objective: 'Resolver o problema de quem procura.',
        interpretedIntent: 'Criar um suporte reativo',
        rationale: 'O usuário disse que quem começa é a pessoa.',
        humanSummary: 'Criei o Caio.',
        mutations: [{ kind: 'SET_AGENT_ENGAGEMENT', initiator: 'USER' }],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
    const result = await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um suporte. Quem começa a conversa é a PESSOA.',
    });

    const found = await agents.findById(tenant(), result.entityId!);
    const prompt = compileAgentPrompt({ agent: found!.version!.canonicalConfig });

    expect(found?.version?.canonicalConfig.engagement.initiator).toBe('USER');
    expect(prompt).not.toContain('VOCÊ ABRE A CONVERSA');
  });
});
