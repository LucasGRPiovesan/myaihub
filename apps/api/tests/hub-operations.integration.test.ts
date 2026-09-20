import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import { type MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
import {
  CREATE_PROJECT_FROM_BRIEF,
  REFINE_PROJECT_PROFILE,
} from '../src/modules/myaihub/domain/operation.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from '../src/modules/myaihub/infrastructure/master-policy.seed.js';
import type { PrismaHubConversationRepository } from '../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import type { PrismaProjectRepository } from '../src/modules/projects/infrastructure/prisma-project.repository.js';
import type { UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import type { PrismaMediaRepository } from '../src/modules/media/infrastructure/media.infrastructure.js';
import {
  createTestRunner,
  type FakeMediaStorage,
  type FakeWebContentReader,
} from './helpers/runner.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTHUB0000000000001';
const OTHER_ACCOUNT = '01ACCOUNTHUB0000000000002';
const USER_ID = '01USERHUB00000000000000001'.slice(0, 26);

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return {
    accountId,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/** Saída bem-formada do OS, como o modelo real deve produzir. */
const BRIEF_OUTPUT = JSON.stringify({
  identity: {
    name: 'Easy',
    type: 'saas',
    summary: 'Marketplace que conecta prestadores de serviço a clientes finais.',
  },
  interpretedIntent: 'Estruturar o perfil de um marketplace de prestadores de serviço',
  rationale:
    'O briefing descreve um marketplace que conecta prestadores a clientes. Estruturei o ' +
    'público e a oferta a partir do que foi dito, sem inventar segmentos não mencionados.',
  humanSummary: 'Criei o projeto Easy com o público e a oferta que você descreveu.',
  mutations: [
    {
      kind: 'UPSERT_AUDIENCE',
      semanticKey: 'audience.prestadores_autonomos',
      label: 'Prestadores autônomos',
      statement: 'Profissionais que trabalham por conta própria e buscam mais clientes.',
    },
    {
      kind: 'UPSERT_OFFERING',
      semanticKey: 'offering.captacao_de_clientes',
      label: 'Captação de clientes',
      statement: 'Conecta o prestador a clientes próximos que procuram seu serviço.',
    },
  ],
  conflicts: [],
  gaps: ['Qual a região de atuação inicial?'],
});

describe.skipIf(!enabled)('MyAIHub OS — operações (integração)', () => {
  const provider = new FakeProvider();

  let ids: UlidGenerator;
  let web: FakeWebContentReader;
  let media: PrismaMediaRepository;
  let storage: FakeMediaStorage;
  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let projects: PrismaProjectRepository;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.create({ data: { id: ACCOUNT_ID, name: 'Conta Hub', slug: 'conta-hub' } });
    await rawDb.user.create({
      data: {
        id: USER_ID,
        name: 'Operador',
        email: 'operador@exemplo.com',
        passwordHash: 'scrypt$x',
      },
    });

    provider.reset();

    const harness = createTestRunner(provider);
    runner = harness.runner;
    projects = harness.projects;
    conversations = harness.conversations;
    ids = harness.ids;
    web = harness.web;
    media = harness.media;
    storage = harness.storage;

    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function startConversation(scopeId: string | null = null) {
    return conversations.create(tenant(), {
      id: ids.generate(),
      scope: scopeId ? 'PROJECT' : 'ROOT',
      scopeId,
      title: null,
    });
  }

  // ---------------------------------------------------------------- Flow 1
  it('cria um projeto a partir de um briefing em linguagem natural', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Tenho um marketplace que conecta prestadores de serviço a clientes.',
    });

    const project = await projects.findById(tenant(), result.entityId!);

    expect(project?.project.name).toBe('Easy');
    expect(project?.profile?.versionNumber).toBe(1);
    expect(project?.profile?.canonicalConfig.type).toBe('saas');
    expect(project?.profile?.canonicalConfig.audiences).toHaveLength(1);
    expect(project?.profile?.canonicalConfig.audiences[0]?.code).toBe('AU01');
  });

  it('grava a cadeia completa de rastreabilidade da fala até a versão', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Tenho um marketplace de prestadores.',
    });

    const change = await rawDb.configurationChange.findFirstOrThrow({
      where: { accountId: ACCOUNT_ID, entityId: result.entityId! },
    });

    // Fala → operação → intenção interpretada → mutações → versão (§4.2).
    expect(change.hubMessageId).toBeTruthy();
    expect(change.hubOperationId).toBe(result.operationId);
    expect(change.interpretedIntent).toContain('marketplace');
    expect(change.toVersion).toBe(1);
    expect(change.fromVersion).toBeNull();
    expect(Array.isArray(change.mutations)).toBe(true);

    const message = await rawDb.hubMessage.findUniqueOrThrow({
      where: { id: change.hubMessageId! },
    });
    expect(message.content).toContain('marketplace');
  });

  it('registra auditoria e AiCall na mesma operação', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace de prestadores.',
    });

    const [audit, calls] = await Promise.all([
      rawDb.auditLog.findFirst({ where: { accountId: ACCOUNT_ID, action: 'project.created' } }),
      rawDb.aiCall.findMany({ where: { accountId: ACCOUNT_ID } }),
    ]);

    expect(audit).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.role).toBe('hub.reasoning');
    // A policy usada fica registrada na chamada (§8 dos ajustes).
    expect(calls[0]?.policyVersionId).toBeTruthy();
  });

  it('emite os eventos do painel vivo em ordem e os persiste para replay', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace de prestadores.',
    });

    const events = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
      orderBy: { seq: 'asc' },
    });

    const types = events.map((event) => (event.payload as { type: string }).type);

    expect(types[0]).toBe('operation.started');
    expect(types).toContain('operation.progress');
    expect(types).toContain('configuration.applied');
    expect(types.at(-1)).toBe('operation.completed');

    // seq monotônico e sem buracos — é o que sustenta o replay do SSE.
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
  });

  // ------------------------------------------------- escopo de mutação (§7.2)
  it('REJEITA mutação fora do escopo declarado pela operação', async () => {
    // create_from_brief não permite REMOVE_ITEM. Mesmo que o modelo proponha,
    // o domínio recusa — é a fronteira que impede o modelo de ampliar o próprio poder.
    provider.script({
      respond: JSON.stringify({
        identity: { name: 'Easy', type: 'saas', summary: 'Marketplace de prestadores.' },
        interpretedIntent: 'Criar projeto',
        rationale: 'Aplicando o que o usuario pediu.',
        humanSummary: 'ok',
        mutations: [
          {
            kind: 'REMOVE_ITEM',
            facet: 'audiences',
            itemId: 'qualquer',
            reason: 'tentativa fora de escopo',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const conversation = await startConversation();
    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Cria aí.',
    });

    const change = await rawDb.configurationChange.findFirstOrThrow({
      where: { entityId: result.entityId! },
    });

    const applied = change.mutations as Array<{ kind: string }>;
    expect(applied.map((mutation) => mutation.kind)).toEqual(['SET_PROJECT_IDENTITY']);

    // E o usuário é avisado do que foi recusado, em vez de descobrir depois.
    const warnings = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
    });
    const codes = warnings.map((event) => (event.payload as { code?: string }).code);
    expect(codes).toContain('MUTATION_OUT_OF_SCOPE');
  });

  it('recusa saída de criação sem identidade — o schema é a primeira barreira', async () => {
    // Medido contra o modelo real: com a identidade enterrada no array de
    // mutações, ela era omitida e o projeto nascia sem nome. Sendo campo
    // obrigatório de topo, a saída incompleta nem passa da validação.
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Criar projeto com público',
        rationale: 'Aplicando o que o usuario pediu.',
        humanSummary: 'ok',
        mutations: [
          {
            kind: 'UPSERT_AUDIENCE',
            semanticKey: 'audience.clientes_finais',
            label: 'Clientes finais',
            statement: 'Pessoas que contratam o serviço.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const conversation = await startConversation();

    await expect(
      runner.run(tenant(), {
        conversationId: conversation.id,
        operation: CREATE_PROJECT_FROM_BRIEF,
        userMessage: 'Cria.',
      }),
    ).rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_INVALID' });

    await expect(rawDb.project.count({ where: { accountId: ACCOUNT_ID } })).resolves.toBe(0);
  });

  it('não cria versão nova quando toda mutação do refinamento é rejeitada', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    const created = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace.',
    });

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Refinar',
        rationale: 'Aplicando o que o usuario pediu.',
        humanSummary: 'ok',
        // Recusada de verdade: remover um item que não existe. Prefixo errado
        // NÃO serve mais como exemplo — ele é corrigido, não rejeitado.
        mutations: [
          {
            kind: 'REMOVE_ITEM',
            facet: 'offerings',
            itemId: 'item-que-nao-existe',
            reason: 'O usuário pediu.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const refine = await startConversation(created.entityId!);

    await expect(
      runner.run(tenant(), {
        conversationId: refine.id,
        operation: REFINE_PROJECT_PROFILE,
        userMessage: 'Ajusta.',
        targetId: created.entityId!,
      }),
    ).rejects.toMatchObject({ code: 'MUTATION_OUT_OF_SCOPE' });

    // O projeto continua na v1: operação sem efeito não gera versão.
    const versions = await projects.listVersions(tenant(), created.entityId!, 10);
    expect(versions).toHaveLength(1);
  });

  it('aplica o resto quando uma mutação é recusada, em operação sem obrigatórias', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    const created = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace.',
    });

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Refinar público',
        rationale: 'Aplicando o que o usuario pediu.',
        humanSummary: 'ok',
        mutations: [
          // Recusada: o item não existe para ser removido.
          {
            kind: 'REMOVE_ITEM',
            facet: 'offerings',
            itemId: 'item-que-nao-existe',
            reason: 'O usuário pediu.',
          },
          {
            kind: 'UPSERT_AUDIENCE',
            semanticKey: 'audience.clientes_finais',
            label: 'Clientes finais',
            statement: 'Pessoas que contratam o serviço.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const refine = await startConversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: refine.id,
      operation: REFINE_PROJECT_PROFILE,
      userMessage: 'Ajusta.',
      targetId: created.entityId!,
    });

    const project = await projects.findById(tenant(), created.entityId!);

    // A válida passou; a recusada não contaminou o resto nem abortou a operação.
    expect(project?.profile?.canonicalConfig.audiences).toHaveLength(2);
    expect(project?.profile?.canonicalConfig.offerings).toHaveLength(1);
  });

  it('corrige o prefixo da semanticKey em vez de descartar o item', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    const created = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace.',
    });

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Registrar o diferencial',
        rationale: 'O usuário descreveu o que o distingue.',
        humanSummary: 'ok',
        mutations: [
          {
            // Sem o prefixo "differentiator." — erro de forma, não de conteúdo.
            kind: 'UPSERT_DIFFERENTIATOR',
            semanticKey: 'atendimento_centralizado',
            label: 'Atendimento centralizado',
            statement: 'O cliente fala com um só lugar em vez de cinco prestadores.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const refine = await startConversation(created.entityId!);
    const result = await runner.run(tenant(), {
      conversationId: refine.id,
      operation: REFINE_PROJECT_PROFILE,
      userMessage: 'Nosso diferencial é o atendimento centralizado.',
      targetId: created.entityId!,
    });

    const project = await projects.findById(tenant(), created.entityId!);
    const differentiator = project?.profile?.canonicalConfig.differentiators[0];

    // O conteúdo entrou, com a chave corrigida — e o usuário foi avisado.
    expect(differentiator?.semanticKey).toBe('differentiator.atendimento_centralizado');
    expect(differentiator?.statement).toContain('um só lugar');

    const events = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
    });
    const codes = events.map((event) => (event.payload as { code?: string }).code);
    expect(codes).toContain('VALUE_ADJUSTED');
  });

  it('lê o site citado e usa o CONTEÚDO dele, não o nome do domínio', async () => {
    web.serve(
      'https://www.sankar.com.br/home',
      [
        'Sankar — Soluções industriais',
        'Fornecemos automação de linha de produção, manutenção preditiva e',
        'consultoria de eficiência energética para indústrias de médio porte.',
      ].join('\n'),
      'Sankar',
    );

    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Crie um projeto pra esse site: https://www.sankar.com.br/home',
    });

    expect(web.requested).toContain('https://www.sankar.com.br/home');

    // O conteúdo entra na REGIÃO DE DADOS, nunca na de instruções (§9.1).
    const trace = await rawDb.executionTrace.findFirstOrThrow({
      where: { hubOperationId: result.operationId },
    });
    const { kept } = trace.contextBlocks as {
      kept: Array<{ id: string; kind: string; trust: string }>;
    };
    const web0 = kept.find((block) => block.id.startsWith('web.'));

    expect(web0?.kind).toBe('UNTRUSTED');
    expect(web0?.trust).toBe('UNTRUSTED');
  });

  it('avisa e segue quando o site não pode ser lido', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    // Nada registrado no leitor: a página não responde.
    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Crie um projeto: https://site-que-nao-existe.invalido',
    });

    // A operação NÃO falha: o usuário ainda pode descrever por escrito.
    const events = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
    });
    const codes = events.map((event) => (event.payload as { code?: string }).code);
    expect(codes).toContain('SOURCE_UNREACHABLE');
  });

  it('manda a imagem anexada ao modelo, como DADO da fala do usuário', async () => {
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const key = await storage.put(ACCOUNT_ID, '01ASSET0000000000000000001', 'image/png', bytes);
    const asset = await media.create(tenant(), {
      id: '01ASSET0000000000000000001',
      mimeType: 'image/png',
      byteSize: bytes.length,
      fileName: 'print.png',
      storageKey: key,
      width: 100,
      height: 50,
      uploadedBy: USER_ID,
    });

    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Cria o projeto a partir deste print.',
      attachmentIds: [asset.id],
    });

    const request = provider.requests.at(-1);
    const userMessage = request?.messages.at(-1);

    // A imagem vai na MENSAGEM DO USUÁRIO, nunca na instrução de sistema (§9.1).
    expect(userMessage?.images).toHaveLength(1);
    expect(userMessage?.images?.[0]?.mimeType).toBe('image/png');
    expect(userMessage?.images?.[0]?.data).toBe(bytes.toString('base64'));
    expect(request?.systemInstruction).not.toContain(bytes.toString('base64'));
  });

  it('não derruba a operação quando o anexo sumiu', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();

    const result = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Cria o projeto.',
      attachmentIds: ['01SUMIU00000000000000000001'],
    });

    // O texto do usuário continua valendo; ele só é avisado.
    const events = await rawDb.hubOperationEvent.findMany({
      where: { operationId: result.operationId },
    });
    const codes = events.map((event) => (event.payload as { code?: string }).code);
    expect(codes).toContain('ATTACHMENT_MISSING');
  });

  it('guarda o anexo na fala, para o transcrito remontar depois', async () => {
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const key = await storage.put(ACCOUNT_ID, '01ASSET0000000000000000002', 'image/png', bytes);
    const asset = await media.create(tenant(), {
      id: '01ASSET0000000000000000002',
      mimeType: 'image/png',
      byteSize: bytes.length,
      fileName: 'print.png',
      storageKey: key,
      width: 100,
      height: 50,
      uploadedBy: USER_ID,
    });

    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Olha este print.',
      attachmentIds: [asset.id],
    });

    const messages = await conversations.listMessages(tenant(), conversation.id, 10);
    expect(messages[0]?.attachments).toEqual([asset.id]);
  });

  it('não enxerga anexo de outra conta', async () => {
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const key = await storage.put(ACCOUNT_ID, '01ASSET0000000000000000003', 'image/png', bytes);
    const asset = await media.create(tenant(), {
      id: '01ASSET0000000000000000003',
      mimeType: 'image/png',
      byteSize: bytes.length,
      fileName: 'print.png',
      storageKey: key,
      width: 10,
      height: 10,
      uploadedBy: USER_ID,
    });

    expect(await media.findById(tenant(OTHER_ACCOUNT), asset.id)).toBeNull();
    expect(await media.findManyByIds(tenant(OTHER_ACCOUNT), [asset.id])).toEqual([]);
  });

  // ---------------------------------------------------- deduplicação (§5.1)
  it('FUNDE no item existente quando a semanticKey se repete, em vez de duplicar', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    const created = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace de prestadores.',
    });

    const before = await projects.findById(tenant(), created.entityId!);
    const originalId = before?.profile?.canonicalConfig.audiences[0]?.id;

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Refinar a descrição do público',
        rationale: 'O usuário detalhou o mesmo público, então refinei o item existente.',
        humanSummary: 'Refinei a descrição do público.',
        mutations: [
          {
            kind: 'UPSERT_AUDIENCE',
            semanticKey: 'audience.prestadores_autonomos',
            label: 'Prestadores autônomos',
            statement: 'Profissionais autônomos que dependem de indicação para conseguir clientes.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const refineConversation = await startConversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: refineConversation.id,
      operation: REFINE_PROJECT_PROFILE,
      userMessage: 'Detalha melhor o público.',
      targetId: created.entityId!,
    });

    const after = await projects.findById(tenant(), created.entityId!);

    // Um item só, com o MESMO id técnico — refinado, não duplicado.
    expect(after?.profile?.canonicalConfig.audiences).toHaveLength(1);
    expect(after?.profile?.canonicalConfig.audiences[0]?.id).toBe(originalId);
    expect(after?.profile?.canonicalConfig.audiences[0]?.statement).toContain('indicação');
    expect(after?.profile?.versionNumber).toBe(2);
  });

  it('encadeia as versões e preserva a anterior', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    const created = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace.',
    });

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Ajustar o resumo',
        rationale: 'Aplicando o que o usuario pediu.',
        humanSummary: 'ok',
        mutations: [{ kind: 'SET_PROJECT_IDENTITY', summary: 'Resumo revisado.' }],
        conflicts: [],
        gaps: [],
      }),
    });

    const refineConversation = await startConversation(created.entityId!);
    await runner.run(tenant(), {
      conversationId: refineConversation.id,
      operation: REFINE_PROJECT_PROFILE,
      userMessage: 'Muda o resumo.',
      targetId: created.entityId!,
    });

    const versions = await projects.listVersions(tenant(), created.entityId!, 10);

    expect(versions).toHaveLength(2);
    // A v1 continua intacta: histórico não se reescreve (§18).
    expect(versions[1]?.versionNumber).toBe(1);
    expect(versions[1]?.canonicalConfig.summary).toContain('Marketplace');
    expect(versions[0]?.canonicalConfig.summary).toBe('Resumo revisado.');
  });

  // ------------------------------------------------------- tenant isolation
  it('não enxerga projeto de outra conta', async () => {
    provider.script({ respond: BRIEF_OUTPUT });
    const conversation = await startConversation();
    const created = await runner.run(tenant(), {
      conversationId: conversation.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Marketplace.',
    });

    const otherTenant: TenantContext = {
      ...tenant(),
      accountId: '01ACCOUNTOTHER0000000001X'.slice(0, 26),
    };
    await expect(projects.findById(otherTenant, created.entityId!)).resolves.toBeNull();
  });
});
