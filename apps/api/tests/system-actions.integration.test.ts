import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import type { MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
import { getSystemAction } from '../src/modules/myaihub/domain/system-action.js';
import type { PrismaHubConversationRepository } from '../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import type { UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import { createTestRunner } from './helpers/runner.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTACT0000000000001';
const USER_ID = '01USERACT00000000000000001'.slice(0, 26);

function tenant(): TenantContext {
  return {
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/**
 * O S.O FAZ O QUE A TELA FAZ.
 *
 * O caso que motivou: "Vincula ele já no projeto Sankar", com o agente nomeado
 * — e o S.O respondeu explicando onde clicar. Aqui se prova que a ação roda
 * pelo MESMO use case da tela, grava de verdade e aparece no painel pelos
 * mesmos eventos de qualquer turno.
 */
describe.skipIf(!enabled)('Ações do sistema pelo S.O (integração)', () => {
  const provider = new FakeProvider();
  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let ids: UlidGenerator;

  let projectId: string;
  let campaignId: string;
  let agentId: string;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.create({
      data: { id: ACCOUNT_ID, name: 'Conta Ações', slug: 'conta-acoes' },
    });
    await rawDb.user.create({
      data: { id: USER_ID, name: 'Op', email: 'op-act@exemplo.com', passwordHash: 'scrypt$x' },
    });

    const harness = createTestRunner(provider);
    runner = harness.runner;
    conversations = harness.conversations;
    ids = harness.ids;

    projectId = ids.generate();
    campaignId = ids.generate();
    agentId = ids.generate();

    await rawDb.project.create({
      data: {
        id: projectId,
        accountId: ACCOUNT_ID,
        name: 'Sankar',
        slug: 'sankar',
        createdBy: USER_ID,
      },
    });
    await rawDb.campaign.create({
      data: {
        id: campaignId,
        accountId: ACCOUNT_ID,
        projectId,
        name: 'Linha Industrial Sankar',
        slug: 'linha',
        createdBy: USER_ID,
      },
    });
    await rawDb.agent.create({
      data: {
        id: agentId,
        accountId: ACCOUNT_ID,
        name: 'Alex',
        slug: 'alex',
        role: 'Representante Comercial',
        createdBy: USER_ID,
      },
    });
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function conversa() {
    return conversations.create(tenant(), {
      id: ids.generate(),
      scope: 'ROOT',
      scopeId: null,
      title: null,
    });
  }

  async function eventos(operationId: string) {
    const rows = await rawDb.hubOperationEvent.findMany({
      where: { operationId },
      orderBy: { seq: 'asc' },
    });
    return rows.map((row) => row.payload as { type: string; [key: string]: unknown });
  }

  it('vincula o agente à campanha, e o painel recebe o turno inteiro', async () => {
    const talk = await conversa();
    const acted = await runner.act(tenant(), {
      conversationId: talk.id,
      userMessage: 'Vincula ele já no projeto Sankar',
      action: getSystemAction('campaign.bind_agent')!,
      args: {
        targetId: campaignId,
        targetName: 'Linha Industrial Sankar',
        secondaryId: agentId,
        secondaryName: 'Alex',
      },
      costMicros: 0,
      totalTokens: 0,
    });

    const campanha = await rawDb.campaign.findFirst({ where: { id: campaignId } });
    expect(campanha?.agentId).toBe(agentId);

    // Mesma auditoria da tela: é o mesmo use case.
    await expect(
      rawDb.auditLog.count({ where: { accountId: ACCOUNT_ID, action: 'campaign.agent_bound' } }),
    ).resolves.toBe(1);

    const tipos = (await eventos(acted.id)).map((event) => event.type);
    expect(tipos).toEqual([
      'operation.started',
      'workspace.patch',
      'message.delta',
      'operation.completed',
    ]);

    const mensagens = await conversations.listMessages(tenant(), talk.id, 10);
    expect(mensagens.at(-1)?.content).toContain('Alex');
  });

  it('a regra de negócio da ação chega ao usuário como falha, com o motivo', async () => {
    await rawDb.campaign.update({ where: { id: campaignId }, data: { agentId } });

    const talk = await conversa();
    const acted = await runner.act(tenant(), {
      conversationId: talk.id,
      userMessage: 'sim',
      action: getSystemAction('agent.delete')!,
      args: { targetId: agentId, targetName: 'Alex' },
      costMicros: 0,
      totalTokens: 0,
    });

    const fim = (await eventos(acted.id)).at(-1);
    expect(fim).toMatchObject({ type: 'operation.completed', status: 'failed' });
    await expect(rawDb.agent.count({ where: { id: agentId } })).resolves.toBe(1);
  });

  it('o histórico é das ÚLTIMAS falas, em ordem — não das primeiras', async () => {
    // Era `asc` + `take`: numa conversa longa, o roteador e o runner liam o
    // COMEÇO dela como se fosse o que acabou de ser dito.
    const talk = await conversa();
    for (let i = 1; i <= 6; i += 1) {
      await conversations.appendMessage(tenant(), {
        id: ids.generate(),
        conversationId: talk.id,
        role: i % 2 ? 'USER' : 'ASSISTANT',
        content: `fala ${i}`,
      });
    }

    const recentes = await conversations.listMessages(tenant(), talk.id, 3);
    expect(recentes.map((message) => message.content)).toEqual(['fala 4', 'fala 5', 'fala 6']);
  });

  it('texto de conhecimento é guardado como foi escrito, a partir do marcador', async () => {
    const talk = await conversa();
    const texto = 'Atendemos de segunda a sexta, das 8h às 18h.\nNão fazemos entrega aos sábados.';

    await runner.act(tenant(), {
      conversationId: talk.id,
      userMessage: `Guarda isso no conhecimento do Sankar: ${texto}`,
      action: getSystemAction('knowledge.add_text')!,
      args: { targetId: projectId, targetName: 'Sankar', value: 'Atendemos de segunda a sexta' },
      costMicros: 0,
      totalTokens: 0,
    });

    const fonte = await rawDb.projectKnowledgeSource.findFirst({
      where: { accountId: ACCOUNT_ID, projectId },
      include: { revisions: true },
    });
    expect(fonte?.kind).toBe('TEXT');
    expect(fonte?.revisions[0]?.extractedContent).toBe(texto);
  });
});
