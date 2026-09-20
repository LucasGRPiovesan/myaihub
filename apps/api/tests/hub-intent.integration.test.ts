import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import type { MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
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

const ACCOUNT_ID = '01ACCOUNTINT0000000000001';
const USER_ID = '01USERINT00000000000000001'.slice(0, 26);

function tenant(): TenantContext {
  return {
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

const CRIACAO = JSON.stringify({
  identity: { name: 'David', role: 'Representante Comercial' },
  objective: 'Qualificar demandas antes de qualquer proposta.',
  interpretedIntent: 'Criar um representante comercial',
  rationale: 'Papel reconhecível.',
  humanSummary: 'Criei o David.',
  mutations: [],
  conflicts: [],
  gaps: [],
});

const SO_RESPONDEU = JSON.stringify({
  intent: 'ANSWER',
  interpretedIntent: 'Explicar o erro do agente',
  rationale: 'O usuário descreveu o erro.',
  humanSummary: 'O David acertou em X e errou em Y.',
  mutations: [],
  conflicts: [],
  gaps: [],
});

const CORRIGIU = JSON.stringify({
  intent: 'CHANGE',
  interpretedIntent: 'Corrigir a leitura da intenção declarada',
  rationale: 'O usuário relatou o erro.',
  humanSummary: 'Corrigi: ele passa a tratar o que a pessoa declarou como dado.',
  mutations: [
    {
      kind: 'UPSERT_BEHAVIOR',
      semanticKey: 'behavior.le_intencao_declarada',
      label: 'Lê a intenção declarada',
      statement:
        'Quando a pessoa já disse o que precisa, trata isso como dado e não oferece alternativa que a empresa não faz.',
      origin: 'USER_DIRECTED',
    },
  ],
  conflicts: [],
  gaps: [],
});

const FORA_DO_ALCANCE = JSON.stringify({
  intent: 'ANSWER',
  limitation: {
    summary: 'Enviar o orçamento por e-mail ao fim da conversa',
    need: 'Integração de e-mail de saída para o agente',
  },
  interpretedIntent: 'Mandar o orçamento por e-mail',
  rationale: 'O sistema não envia e-mail.',
  humanSummary: 'Hoje o MyAIHub não envia e-mail; registrei isso para a equipe.',
  mutations: [],
  conflicts: [],
  gaps: [],
});

/**
 * RESPONDER OU AGIR — e o que o S.O não alcança.
 *
 * O caso real: o usuário explicou o erro do agente ("acertou em X, errou em
 * Y… entendeu?") e o S.O respondeu com uma boa análise, sem corrigir nada.
 */
describe.skipIf(!enabled)('Relato de erro e limite do sistema (integração)', () => {
  const provider = new FakeProvider();
  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let ids: UlidGenerator;
  let agentId: string;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.create({ data: { id: ACCOUNT_ID, name: 'Conta', slug: 'conta-int' } });
    await rawDb.user.create({
      data: { id: USER_ID, name: 'Op', email: 'op-int@exemplo.com', passwordHash: 'scrypt$x' },
    });

    const harness = createTestRunner(provider);
    runner = harness.runner;
    conversations = harness.conversations;
    ids = harness.ids;
    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);

    provider.reset();
    provider.script({ respond: CRIACAO });
    const criado = await runner.run(tenant(), {
      conversationId: (await conversa()).id,
      operation: CREATE_AGENT,
      userMessage: 'cria um representante comercial',
    });
    agentId = criado.entityId!;
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function conversa() {
    return conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'AGENT',
      scopeId: agentId ?? null,
      title: null,
    });
  }

  const pediuCorrecao = (request: { messages: Array<{ content: unknown }> }) =>
    String(request.messages.at(-1)?.content ?? '').includes('RELATOU UM ERRO');

  it('relato de erro respondido sem ação é revisto — e vira correção', async () => {
    provider.reset();
    provider.script({ match: pediuCorrecao, respond: CORRIGIU });
    provider.script({ respond: SO_RESPONDEU });

    const resultado = await runner.run(tenant(), {
      conversationId: (await conversa()).id,
      operation: CONFIGURE_AGENT,
      targetId: agentId,
      userMessage: 'O agente acertou em X, porém errou em Y. Entendeu?',
      requestSignals: ['FAILURE_REPORT'],
    });

    expect(provider.requests).toHaveLength(2);
    expect(resultado.toVersion).toBe(2);
    const versao = await rawDb.agentVersion.findFirst({
      where: { agentId, versionNumber: 2 },
    });
    expect(JSON.stringify(versao?.canonicalConfig)).toContain('behavior.le_intencao_declarada');
  });

  it('dúvida pura continua sendo resposta — sem revisão, sem versão', async () => {
    provider.reset();
    provider.script({ respond: SO_RESPONDEU });

    const resultado = await runner.run(tenant(), {
      conversationId: (await conversa()).id,
      operation: CONFIGURE_AGENT,
      targetId: agentId,
      userMessage: 'como ele decide quando parar de insistir?',
      requestSignals: [],
    });

    expect(provider.requests).toHaveLength(1);
    expect(resultado.toVersion).toBeUndefined();
  });

  it('o que o sistema não alcança vira pauta de suporte do admin', async () => {
    provider.reset();
    provider.script({ respond: FORA_DO_ALCANCE });

    const resultado = await runner.run(tenant(), {
      conversationId: (await conversa()).id,
      operation: CONFIGURE_AGENT,
      targetId: agentId,
      userMessage: 'quero que ele mande o orçamento por e-mail pro cliente no fim',
      requestSignals: [],
    });

    const pauta = await rawDb.systemLimitation.findMany({ where: { accountId: ACCOUNT_ID } });
    expect(pauta).toHaveLength(1);
    expect(pauta[0]).toMatchObject({
      status: 'OPEN',
      operation: 'agent.configure',
      summary: 'Enviar o orçamento por e-mail ao fim da conversa',
    });
    expect(pauta[0]?.userMessage).toContain('e-mail');

    const eventos = await rawDb.hubOperationEvent.findMany({
      where: { operationId: resultado.operationId },
    });
    expect(
      eventos.some(
        (evento) => (evento.payload as { code?: string }).code === 'LIMITATION_RECORDED',
      ),
    ).toBe(true);
  });
});
