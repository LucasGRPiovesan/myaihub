import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ModelRouter } from '../src/modules/ai/application/model-router.js';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import { PublishCampaignUseCase } from '../src/modules/campaigns/application/publish-campaign.use-case.js';
import { canonicalize } from '../src/modules/campaigns/domain/manifest.js';
import type { PrismaCampaignRepository } from '../src/modules/campaigns/infrastructure/prisma-campaign.repository.js';
import { type MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
import { CREATE_AGENT } from '../src/modules/myaihub/domain/agent-operations.js';
import {
  CONFIGURE_CAMPAIGN_CTA,
  CREATE_CAMPAIGN,
  REFINE_CAMPAIGN_STRATEGY,
} from '../src/modules/myaihub/domain/campaign-operations.js';
import { CREATE_PROJECT_FROM_BRIEF } from '../src/modules/myaihub/domain/operation.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from '../src/modules/myaihub/infrastructure/master-policy.seed.js';
import type { PrismaHubConversationRepository } from '../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import type { PrismaAgentRepository } from '../src/modules/agents/infrastructure/prisma-agent.repository.js';
import type { PrismaProjectRepository } from '../src/modules/projects/infrastructure/prisma-project.repository.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import type { UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import { createTestRunner } from './helpers/runner.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTCMP0000000000001';
const OTHER_ACCOUNT = '01ACCOUNTCMP0000000000002';
const USER_ID = '01USERCMP00000000000000001'.slice(0, 26);

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return { accountId, userId: USER_ID, role: 'USER', membershipRole: 'OWNER', elevated: false };
}

const PROJECT_OUTPUT = JSON.stringify({
  identity: {
    name: 'Easy',
    type: 'saas',
    summary: 'Marketplace que conecta prestadores autônomos a clientes da região.',
  },
  interpretedIntent: 'Criar o projeto Easy',
  rationale: 'O usuário descreveu um marketplace de serviços.',
  humanSummary: 'Criei o projeto Easy.',
  mutations: [],
  conflicts: [],
  gaps: [],
});

const AGENT_OUTPUT = JSON.stringify({
  identity: { name: 'Philips', role: 'Representante Comercial' },
  objective: 'Cadastrar prestadores autônomos na plataforma.',
  interpretedIntent: 'Criar o Philips',
  rationale: 'Vendedor consultivo.',
  humanSummary: 'Criei o Philips.',
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
});

const CAMPAIGN_OUTPUT = JSON.stringify({
  identity: {
    name: 'Captação de Eletricistas',
    summary: 'Traz eletricistas autônomos da região metropolitana para a plataforma.',
  },
  objective: 'Converter eletricistas autônomos em cadastros ativos.',
  interpretedIntent: 'Criar campanha de captação de eletricistas',
  rationale: 'O usuário quer captar um nicho específico.',
  humanSummary: 'Criei a campanha de captação de eletricistas.',
  mutations: [
    {
      kind: 'UPSERT_AUDIENCE_SEGMENT',
      semanticKey: 'audience.eletricistas_autonomos',
      label: 'Eletricistas autônomos',
      statement: 'Profissionais que trabalham por conta e buscam mais clientes.',
    },
    {
      kind: 'UPSERT_DISCOVERY_DIMENSION',
      semanticKey: 'discovery.volume_atual',
      label: 'Volume atual de trabalho',
      statement: 'Quantos serviços a pessoa faz por semana hoje.',
    },
  ],
  conflicts: [],
  gaps: [],
});

describe.skipIf(!enabled)('Campanhas — criação, vínculo e publicação (integração)', () => {
  const provider = new FakeProvider();

  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let campaigns: PrismaCampaignRepository;
  let projects: PrismaProjectRepository;
  let agents: PrismaAgentRepository;
  let ids: UlidGenerator;
  let publish: PublishCampaignUseCase;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.createMany({
      data: [
        { id: ACCOUNT_ID, name: 'Conta Campanhas', slug: 'conta-campanhas' },
        { id: OTHER_ACCOUNT, name: 'Outra', slug: 'outra-campanhas' },
      ],
    });
    await rawDb.user.create({
      data: { id: USER_ID, name: 'Op', email: 'op-cmp@exemplo.com', passwordHash: 'scrypt$x' },
    });

    provider.reset();

    const harness = createTestRunner(provider);
    runner = harness.runner;
    conversations = harness.conversations;
    campaigns = harness.campaigns;
    projects = harness.projects;
    agents = harness.agents;
    ids = harness.ids;

    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);

    publish = new PublishCampaignUseCase({
      campaigns,
      projects,
      brands: harness.brands,
      knowledge: harness.knowledge,
      agents,
      router: new ModelRouter(
        {
          'hub.reasoning': { provider: 'fake', model: 'fake-1' },
          'hub.fast': { provider: 'fake', model: 'fake-1' },
          'agent.runtime': { provider: 'fake', model: 'fake-runtime-1' },
          'validation.fast': { provider: 'fake', model: 'fake-1' },
          'analysis.vision': { provider: 'fake', model: 'fake-1' },
        },
        new Map([['fake', provider]]),
      ),
      ids,
    });
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function conversation(scope: 'ROOT' | 'PROJECT' | 'CAMPAIGN', scopeId: string | null) {
    return conversations.create(tenant(), { id: ids.generate(), scope, scopeId, title: null });
  }

  async function createProject() {
    provider.reset();
    provider.script({ respond: PROJECT_OUTPUT });
    const talk = await conversation('ROOT', null);
    return runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_PROJECT_FROM_BRIEF,
      userMessage: 'Tenho um marketplace de serviços.',
    });
  }

  async function createAgent() {
    provider.reset();
    provider.script({ respond: AGENT_OUTPUT });
    const talk = await conversation('ROOT', null);
    return runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_AGENT,
      userMessage: 'Quero um representante comercial.',
    });
  }

  async function createCampaign(projectId: string) {
    provider.reset();
    provider.script({ respond: CAMPAIGN_OUTPUT });
    // A conversa é do PROJETO: a campanha ainda não existe.
    const talk = await conversation('PROJECT', projectId);
    return runner.run(tenant(), {
      conversationId: talk.id,
      operation: CREATE_CAMPAIGN,
      userMessage: 'Quero uma campanha para captar eletricistas.',
      targetId: projectId,
    });
  }

  // ----------------------------------------------------------------- criar
  it('cria a campanha dentro do projeto a partir do id do PAI', async () => {
    const project = await createProject();
    const result = await createCampaign(project.entityId!);

    const found = await campaigns.findById(tenant(), result.entityId!);

    expect(found?.campaign.name).toBe('Captação de Eletricistas');
    expect(found?.campaign.projectId).toBe(project.entityId!);
    expect(found?.campaign.status).toBe('DRAFT');
    // Nasce sem agente: escolher por quem fala com o cliente é do usuário.
    expect(found?.campaign.agentId).toBeNull();

    const canonical = found?.version?.canonicalConfig;
    expect(canonical?.goal.primary).toContain('cadastros ativos');
    expect(canonical?.audience[0]?.code).toBe('AU01');
    expect(canonical?.discoveryDimensions[0]?.code).toBe('DD01');
  });

  it('recusa criar campanha em projeto sem perfil — contexto obrigatório declarado', async () => {
    // Projeto cru, sem versão de perfil: o requisito `project.profile` da
    // operação não tem como ser satisfeito.
    const orphan = await rawDb.project.create({
      data: {
        id: ids.generate(),
        accountId: ACCOUNT_ID,
        name: 'Sem perfil',
        slug: 'sem-perfil',
        createdBy: USER_ID,
      },
    });

    provider.reset();
    provider.script({ respond: CAMPAIGN_OUTPUT });
    const talk = await conversation('PROJECT', orphan.id);

    await expect(
      runner.run(tenant(), {
        conversationId: talk.id,
        operation: CREATE_CAMPAIGN,
        userMessage: 'Quero uma campanha.',
        targetId: orphan.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('não enxerga campanha de outra conta', async () => {
    const project = await createProject();
    const result = await createCampaign(project.entityId!);

    expect(await campaigns.findById(tenant(OTHER_ACCOUNT), result.entityId!)).toBeNull();
  });

  // ----------------------------------------------------------------- refinar
  it('refina a estratégia gerando nova versão e reaproveitando o semanticKey', async () => {
    const project = await createProject();
    const created = await createCampaign(project.entityId!);

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Aprofundar a descoberta',
        rationale: 'Mesma dimensão, mais específica.',
        humanSummary: 'Aprofundei a descoberta de volume.',
        mutations: [
          {
            kind: 'UPSERT_DISCOVERY_DIMENSION',
            semanticKey: 'discovery.volume_atual',
            label: 'Volume atual de trabalho',
            statement: 'Quantos serviços por semana e qual o ticket médio praticado.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation('CAMPAIGN', created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: REFINE_CAMPAIGN_STRATEGY,
      userMessage: 'A descoberta de volume precisa perguntar o ticket médio também.',
      targetId: created.entityId!,
    });

    const found = await campaigns.findById(tenant(), created.entityId!);
    expect(found?.version?.versionNumber).toBe(2);
    // Fundiu no item existente: uma dimensão, não duas.
    expect(found?.version?.canonicalConfig.discoveryDimensions).toHaveLength(1);
    expect(found?.version?.canonicalConfig.discoveryDimensions[0]?.statement).toContain(
      'ticket médio',
    );
  });

  it('a operação de CTA não consegue alterar o público, mesmo que o modelo proponha', async () => {
    const project = await createProject();
    const created = await createCampaign(project.entityId!);

    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Configurar o CTA',
        rationale: 'O usuário quer um botão de cadastro.',
        humanSummary: 'Configurei o CTA.',
        mutations: [
          {
            kind: 'SET_CAMPAIGN_CTA',
            enabled: true,
            label: 'Quero me cadastrar',
            url: 'https://easy.exemplo.com/cadastro',
            condition: 'Depois de entender o volume de trabalho da pessoa.',
          },
          // Fora do escopo declarado: tem que ser recusada.
          {
            kind: 'UPSERT_AUDIENCE_SEGMENT',
            semanticKey: 'audience.encanadores',
            label: 'Encanadores',
            statement: 'Público que ninguém pediu.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation('CAMPAIGN', created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: CONFIGURE_CAMPAIGN_CTA,
      userMessage: 'Coloca um botão de cadastro.',
      targetId: created.entityId!,
    });

    const found = await campaigns.findById(tenant(), created.entityId!);
    expect(found?.version?.canonicalConfig.cta.enabled).toBe(true);
    expect(found?.version?.canonicalConfig.cta.label).toBe('Quero me cadastrar');
    // O público continua com UM segmento: a mutação fora de escopo não passou.
    expect(found?.version?.canonicalConfig.audience).toHaveLength(1);
  });

  // ---------------------------------------------------------------- publicar
  it('recusa publicar sem agente vinculado', async () => {
    const project = await createProject();
    const created = await createCampaign(project.entityId!);

    await expect(publish.execute(tenant(), created.entityId!)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('vincula o agente e publica congelando o manifest', async () => {
    const project = await createProject();
    const agent = await createAgent();
    const created = await createCampaign(project.entityId!);

    const before = await campaigns.findById(tenant(), created.entityId!);
    await campaigns.bindAgent(tenant(), {
      campaignId: created.entityId!,
      expectedLockVersion: before!.campaign.lockVersion,
      agentId: agent.entityId!,
      audit: {
        accountId: ACCOUNT_ID,
        actorUserId: USER_ID,
        action: 'campaign.agent_bound',
        entityType: 'Campaign',
        entityId: created.entityId!,
      },
    });

    const published = await publish.execute(tenant(), created.entityId!);

    expect(published.deployment.deploymentNumber).toBe(1);
    expect(published.deployment.status).toBe('ACTIVE');
    expect(published.publicId).toHaveLength(26);

    const manifest = published.deployment.manifest;
    expect(manifest.agentId).toBe(agent.entityId!);
    expect(manifest.projectId).toBe(project.entityId!);
    // Provider resolvido na PUBLICAÇÃO, não em runtime (§4.3).
    expect(manifest.providerConfig.model).toBe('fake-runtime-1');
    // Checker determinístico do agente congelado junto.
    expect(manifest.ruleChecks).toContainEqual({
      name: 'max_questions_per_message',
      params: { max: 1 },
    });

    const after = await campaigns.findById(tenant(), created.entityId!);
    expect(after?.campaign.status).toBe('PUBLISHED');
  });

  it('alterar a campanha depois de publicar NÃO muda o que está no ar', async () => {
    const project = await createProject();
    const agent = await createAgent();
    const created = await createCampaign(project.entityId!);

    const before = await campaigns.findById(tenant(), created.entityId!);
    await campaigns.bindAgent(tenant(), {
      campaignId: created.entityId!,
      expectedLockVersion: before!.campaign.lockVersion,
      agentId: agent.entityId!,
      audit: {
        accountId: ACCOUNT_ID,
        actorUserId: USER_ID,
        action: 'campaign.agent_bound',
        entityType: 'Campaign',
        entityId: created.entityId!,
      },
    });

    const first = await publish.execute(tenant(), created.entityId!);

    // Muda a estratégia DEPOIS de publicar.
    provider.reset();
    provider.script({
      respond: JSON.stringify({
        interpretedIntent: 'Trocar o objetivo',
        rationale: 'Novo foco.',
        humanSummary: 'Troquei o objetivo.',
        mutations: [
          {
            kind: 'SET_CAMPAIGN_GOAL',
            primary: 'Objetivo completamente diferente do publicado.',
          },
        ],
        conflicts: [],
        gaps: [],
      }),
    });

    const talk = await conversation('CAMPAIGN', created.entityId!);
    await runner.run(tenant(), {
      conversationId: talk.id,
      operation: REFINE_CAMPAIGN_STRATEGY,
      userMessage: 'Muda o objetivo.',
      targetId: created.entityId!,
    });

    const active = await campaigns.findActiveDeployment(tenant(), created.entityId!);

    // O deployment continua apontando para a versão publicada, não para a v2.
    expect(active?.id).toBe(first.deployment.id);
    expect(active?.manifest.campaignVersionId).toBe(first.deployment.manifest.campaignVersionId);
    expect(active?.manifestHash).toBe(first.deployment.manifestHash);

    const current = await campaigns.findById(tenant(), created.entityId!);
    expect(current?.version?.versionNumber).toBe(2);
    expect(active?.manifest.campaignVersionId).not.toBe(current?.version?.id);
  });

  it('republicar preserva o publicId e supersede o anterior', async () => {
    const project = await createProject();
    const agent = await createAgent();
    const created = await createCampaign(project.entityId!);

    const before = await campaigns.findById(tenant(), created.entityId!);
    await campaigns.bindAgent(tenant(), {
      campaignId: created.entityId!,
      expectedLockVersion: before!.campaign.lockVersion,
      agentId: agent.entityId!,
      audit: {
        accountId: ACCOUNT_ID,
        actorUserId: USER_ID,
        action: 'campaign.agent_bound',
        entityType: 'Campaign',
        entityId: created.entityId!,
      },
    });

    const first = await publish.execute(tenant(), created.entityId!);
    const second = await publish.execute(tenant(), created.entityId!);

    // A URL do anúncio não pode quebrar porque alguém republicou.
    expect(second.publicId).toBe(first.publicId);
    expect(second.deployment.deploymentNumber).toBe(2);

    const all = await campaigns.listDeployments(tenant(), created.entityId!, 10);
    expect(all).toHaveLength(2);
    expect(all.find((item) => item.deploymentNumber === 1)?.status).toBe('SUPERSEDED');
    expect(all.find((item) => item.deploymentNumber === 2)?.status).toBe('ACTIVE');
  });

  it('o hash do manifest não depende da ordem das chaves', () => {
    const a = { b: 1, a: [{ y: 2, x: 1 }] };
    const b = { a: [{ x: 1, y: 2 }], b: 1 };

    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});
