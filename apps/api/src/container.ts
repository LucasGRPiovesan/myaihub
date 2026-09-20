import type {
  AuditWriter,
  Clock,
  EventBus,
  IdGenerator,
  Logger,
  PasswordHasher,
  TokenService,
} from './shared/application/ports.js';
import { PrismaAuditWriter } from './shared/infrastructure/audit/prisma-audit-writer.js';
import { JoseTokenService } from './shared/infrastructure/auth/jose-token-service.js';
import { ScryptPasswordHasher } from './shared/infrastructure/crypto/scrypt-password-hasher.js';
import { CredentialCipher } from './shared/infrastructure/crypto/credential-cipher.js';
import { HttpWebContentReader } from './shared/infrastructure/http/web-content-reader.js';
import {
  LocalFileMediaStorage,
  PrismaMediaRepository,
  VercelBlobMediaStorage,
} from './modules/media/infrastructure/media.infrastructure.js';
import type { MediaRouterDependencies } from './modules/media/presentation/media.routes.js';
import { createLogger } from './shared/infrastructure/logging/pino-logger.js';
import { getDb, type Db } from './shared/infrastructure/prisma/client.js';
import { SystemClock, UlidGenerator } from './shared/infrastructure/system-clock.js';

import { AuthenticateUserUseCase } from './modules/identity/application/authenticate-user.use-case.js';
import { GetCurrentUserUseCase } from './modules/identity/application/get-current-user.use-case.js';
import { ListAccountAuditLogsUseCase } from './modules/identity/application/list-account-audit-logs.use-case.js';
import { LogoutUseCase } from './modules/identity/application/logout.use-case.js';
import { RefreshSessionUseCase } from './modules/identity/application/refresh-session.use-case.js';
import { RegisterUserUseCase } from './modules/identity/application/register-user.use-case.js';
import { SessionIssuer } from './modules/identity/application/session-issuer.js';
import {
  PrismaAccountRepository,
  PrismaAuditLogReadRepository,
  PrismaRefreshTokenRepository,
  PrismaRegistrationRepository,
  PrismaUserRepository,
} from './modules/identity/infrastructure/prisma-identity.repositories.js';
import type { AuthRouterDependencies } from './modules/identity/presentation/auth.routes.js';

import { LlmGateway } from './modules/ai/application/llm-gateway.js';
import type { ModelRouter } from './modules/ai/application/model-router.js';
import {
  createModelRouter,
  defaultRoutes,
} from './modules/ai/infrastructure/model-router.factory.js';
import { ModelRouteStore } from './modules/ai/application/model-route-store.js';
import { ServedTierObserver } from './modules/ai/application/served-tier.js';
import { PrismaModelRouteRepository } from './modules/ai/infrastructure/prisma-model-route.repository.js';
import type { ModelsRouterDependencies } from './modules/ai/presentation/models.routes.js';
import { ProviderRegistry } from './modules/ai/infrastructure/providers/provider-registry.js';
import { PrismaProviderCredentialRepository } from './modules/ai/infrastructure/prisma-provider-credential.repository.js';
import { ManageProviderCredentialsUseCase } from './modules/ai/application/manage-provider-credentials.use-case.js';
import { testProviderKey } from './modules/ai/infrastructure/providers/test-connection.js';
import type { ProviderCredentialsRouterDependencies } from './modules/ai/presentation/provider-credentials.routes.js';
import type { LlmProvider } from './modules/ai/domain/provider.js';
import { RecordAiCallUseCase } from './modules/usage/application/record-ai-call.use-case.js';
import {
  PrismaAiCallReadRepository,
  PrismaAiCallRepository,
  PrismaPricingRepository,
} from './modules/usage/infrastructure/prisma-usage.repositories.js';
import type { AiCallReadRepository } from './modules/usage/domain/repositories.js';
import { InMemoryEventBus } from './shared/infrastructure/events/in-memory-event-bus.js';
import type { ProviderName } from '@myaihub/shared';
import { env, isTest } from './config/env.js';

import { ApplyManualMutationsUseCase } from './modules/myaihub/application/apply-manual-mutations.use-case.js';
import {
  MyAIHubOperationRunner,
  type AnyOperationTarget,
} from './modules/myaihub/application/operation-runner.js';
import { DistillPlaybookUseCase } from './modules/myaihub/application/distill-playbook.use-case.js';
import { RevisePlaybookUseCase } from './modules/myaihub/application/revise-playbook.use-case.js';
import type { AdminRouterDependencies } from './modules/myaihub/presentation/admin.routes.js';
import type {
  PlaybookRepository,
  PolicyRepository,
} from './modules/myaihub/domain/repositories.js';
import { PlaybookTarget } from './modules/myaihub/infrastructure/playbook-target.js';
import {
  PrismaHubConversationRepository,
  PrismaHubOperationRepository,
  PrismaPlaybookRepository,
  PrismaSupportRepository,
  PrismaPolicyRepository,
} from './modules/myaihub/infrastructure/prisma-hub.repositories.js';
import type { HubRouterDependencies } from './modules/myaihub/presentation/hub.routes.js';
import type { ManualEditRouterDependencies } from './modules/myaihub/presentation/manual-edit.routes.js';
import { DeleteAgentUseCase } from './modules/agents/application/delete-agent.use-case.js';
import { PlanAgentBriefingUseCase } from './modules/agents/application/plan-agent-briefing.use-case.js';
import { RouteHubRequestUseCase } from './modules/myaihub/application/route-request.use-case.js';
import { AccountInventoryReader } from './modules/myaihub/application/account-inventory.js';
import { PendingAdherence } from './modules/conversations/application/pending-adherence.js';
import { TestAgentUseCase } from './modules/agents/application/test-agent.use-case.js';
import { AgentRehearsalService } from './modules/agents/application/agent-rehearsal.service.js';
import { GeminiProvider } from './modules/ai/infrastructure/providers/gemini-provider.js';
import { PtaxExchangeRateProvider } from './modules/usage/infrastructure/ptax-exchange-rate.js';
import { PrismaAgentRepository } from './modules/agents/infrastructure/prisma-agent.repository.js';
import type { AgentsRouterDependencies } from './modules/agents/presentation/agents.routes.js';
import {
  AgentTarget,
  CampaignTarget,
  ProjectProfileTarget,
} from './modules/myaihub/infrastructure/operation-targets.js';
import { PublicChatUseCase } from './modules/campaigns/application/public-chat.use-case.js';
import { PublishCampaignUseCase } from './modules/campaigns/application/publish-campaign.use-case.js';
import { PrismaCampaignRepository } from './modules/campaigns/infrastructure/prisma-campaign.repository.js';
import { PrismaPublicDeploymentLookup } from './modules/campaigns/infrastructure/prisma-public-deployment.lookup.js';
import type { CampaignsRouterDependencies } from './modules/campaigns/presentation/campaigns.routes.js';
import type { PublicChatRouterDependencies } from './modules/campaigns/presentation/public-chat.routes.js';
import { PrismaProjectRepository } from './modules/projects/infrastructure/prisma-project.repository.js';
import { PrismaBrandIdentityRepository } from './modules/projects/infrastructure/prisma-brand-identity.repository.js';
import { PrismaKnowledgeRepository } from './modules/projects/infrastructure/prisma-knowledge.repository.js';
import { BrandIdentityTarget } from './modules/projects/infrastructure/brand-identity.target.js';
import { ApplyBrandIdentityUseCase } from './modules/projects/application/apply-brand-identity.use-case.js';
import { ManageKnowledgeUseCase } from './modules/projects/application/manage-knowledge.use-case.js';
import { KeywordKnowledgeRetriever } from './modules/projects/domain/knowledge-retriever.js';
import type { ProjectAssetsRouterDependencies } from './modules/projects/presentation/project-assets.routes.js';
import { ConversationService } from './modules/conversations/application/conversation.service.js';
import { SemanticAdherenceValidator } from './modules/conversations/application/adherence-validator.js';
import { PrismaSessionRepository } from './modules/conversations/infrastructure/prisma-conversation.repository.js';
import { PrismaEvidenceReader } from './modules/conversations/infrastructure/prisma-evidence.reader.js';
import type { ConversationsRouterDependencies } from './modules/conversations/presentation/conversations.routes.js';
import { PrismaMetricsRepository } from './modules/metrics/infrastructure/prisma-metrics.repository.js';
import type { MetricsRouterDependencies } from './modules/metrics/presentation/metrics.routes.js';
import type { ProjectsRouterDependencies } from './modules/projects/presentation/projects.routes.js';
import { BindCampaignAgentUseCase } from './modules/campaigns/application/bind-campaign-agent.use-case.js';
import { SyncAgentCraftUseCase } from './modules/myaihub/application/sync-agent-craft.use-case.js';
import { ChangeModelRouteUseCase } from './modules/ai/application/change-model-route.use-case.js';
import { SystemActionExecutor } from './modules/myaihub/application/system-action-executor.js';

/**
 * Composition root.
 *
 * DI manual e explícita: sem container mágico, sem decorators, sem resolução
 * por reflexão. O grafo de dependências é legível de cima a baixo — e quando
 * ele ficar grande demais para um arquivo, isso será sinal de que os módulos
 * devem expor suas próprias factories, não de que precisamos de um framework.
 */
export interface Container {
  db: Db;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;
  hasher: PasswordHasher;
  tokens: TokenService;
  audit: AuditWriter;
  eventBus: EventBus;
  identity: AuthRouterDependencies;
  ai: {
    providers: Map<ProviderName, LlmProvider>;
    router: ModelRouter;
    gateway: LlmGateway;
    /** Carregado no boot; é ele que o gestor de modelos do admin edita. */
    modelRoutes: ModelRouteStore;
    /** Qual cota serviu a última chamada — semeado no boot a partir de `ai_calls`. */
    servedTier: ServedTierObserver;
    /** Carregado no boot; é ele que o gestor de PROVEDORES do admin edita. */
    providerRegistry: ProviderRegistry;
  };
  providerCredentials: ProviderCredentialsRouterDependencies;
  usage: {
    read: AiCallReadRepository;
    /** Aquecido no boot: o primeiro usuário do dia já vê a cotação de hoje. */
    exchangeRate: PtaxExchangeRateProvider;
  };
  projects: ProjectsRouterDependencies;
  projectAssets: ProjectAssetsRouterDependencies;
  conversations: ConversationsRouterDependencies;
  metrics: MetricsRouterDependencies;
  models: ModelsRouterDependencies;
  agents: AgentsRouterDependencies;
  campaigns: CampaignsRouterDependencies;
  media: MediaRouterDependencies;
  /** O chat do público. Sem auth: o tenant sai do publicId, no servidor. */
  publicChat: PublicChatRouterDependencies;
  hub: HubRouterDependencies & { policies: PolicyRepository; playbooks: PlaybookRepository };
  manualEdit: ManualEditRouterDependencies;
  admin: AdminRouterDependencies;
}

export function createContainer(): Container {
  const db = getDb();
  const logger = createLogger();
  const clock = new SystemClock();
  const ids = new UlidGenerator();
  const hasher = new ScryptPasswordHasher();
  const tokens = new JoseTokenService();
  const audit = new PrismaAuditWriter(db, ids);

  const users = new PrismaUserRepository(db);
  const accounts = new PrismaAccountRepository(db);
  const registrations = new PrismaRegistrationRepository(db, audit);
  const refreshTokens = new PrismaRefreshTokenRepository(db);
  const auditLogs = new PrismaAuditLogReadRepository(db);

  const sessionIssuer = new SessionIssuer(accounts, refreshTokens, tokens, ids, clock);

  const identity: AuthRouterDependencies = {
    registerUser: new RegisterUserUseCase(users, registrations, hasher, ids, sessionIssuer),
    authenticateUser: new AuthenticateUserUseCase(users, accounts, hasher, sessionIssuer, clock),
    refreshSession: new RefreshSessionUseCase(
      refreshTokens,
      users,
      tokens,
      sessionIssuer,
      clock,
      logger,
    ),
    logout: new LogoutUseCase(refreshTokens, clock),
    getCurrentUser: new GetCurrentUserUseCase(users, accounts),
    listAccountAuditLogs: new ListAccountAuditLogsUseCase(accounts, auditLogs, audit),
    tokens,
  };

  // --- IA (Fase 3) ---------------------------------------------------------
  // (o bloco abaixo é montado antes do MyAIHub OS, que depende do gateway)
  //
  // A chave de cifra NUNCA é gravada — derivada de um segredo que já existe.
  const credentialCipher = new CredentialCipher(env.JWT_ACCESS_SECRET);
  const providerCredentialRepository = new PrismaProviderCredentialRepository(db);
  const providerRegistry = new ProviderRegistry({
    repository: providerCredentialRepository,
    cipher: credentialCipher,
    // Só para SEMEAR o banco na primeira vez que ele estiver vazio — dali em
    // diante quem manda é a tela.
    envDefaults: {
      gemini: { FREE: env.GEMINI_API_KEY ?? '', PAID: env.GEMINI_API_KEY_PAYED ?? '' },
      openai: { DEFAULT: env.OPENAI_API_KEY ?? '' },
      anthropic: { DEFAULT: env.ANTHROPIC_API_KEY ?? '' },
    },
    logger,
    isTestEnvironment: isTest,
    // Sem isto, uma repetição era invisível: o usuário via um turno de 1,5s
    // virar 30s e nada em lugar nenhum dizia por quê.
    onGeminiRetry: (notice) => logger.warn({ ...notice }, 'gemini: falha transitória, repetindo'),
    // Gasto mudando de bolso se anuncia: a troca é silenciosa para o usuário
    // de propósito, mas não pode ser silenciosa para quem opera.
    onGeminiKeySwitch: (notice) =>
      logger.warn(
        { ...notice, until: notice.until?.toISOString() ?? null },
        notice.tier === 'PAID'
          ? 'gemini: cota gratuita esgotada, usando a chave paga'
          : 'gemini: cota gratuita voltou',
      ),
  });
  const providers = providerRegistry.providers;

  // A escolha do admin, a trava da cota gratuita e o padrão da env — nesta
  // ordem de precedência. O router pergunta a cada chamada, então trocar o
  // modelo pela tela vale no turno seguinte, sem reiniciar nada.
  // QUAL COTA serviu de fato. O adapter só sabe o que TENTARIA agora, e essa
  // previsão reinicia com o processo — foi ela que travou o seletor de modelo
  // como se ainda houvesse cota gratuita, com as chamadas saindo pela paga.
  const servedTier = new ServedTierObserver();
  const modelRoutes = new ModelRouteStore({
    repository: new PrismaModelRouteRepository(db),
    defaults: defaultRoutes(),
    // O FATO primeiro; a previsão do adapter só enquanto não houve chamada
    // nenhuma para observar. Lido pelo MAPA, nunca por uma referência de
    // provider capturada à parte: `providerRegistry.reload()` troca a entrada
    // do mapa, e uma referência guardada antes disso ficaria presa à
    // instância velha.
    quota: () => {
      const gemini = providers.get('gemini');
      return (
        servedTier.last() ?? (gemini instanceof GeminiProvider ? gemini.keyStatus().tier : null)
      );
    },
    logger,
  });

  const router = createModelRouter(providers, logger, () => modelRoutes.all());

  const recordAiCall = new RecordAiCallUseCase(
    new PrismaAiCallRepository(db),
    new PrismaPricingRepository(db),
    ids,
    clock,
  );

  const gateway = new LlmGateway(router, recordAiCall, servedTier);
  const eventBus = new InMemoryEventBus();

  // --- Projects (Fase 5) + MyAIHub OS (Fase 4) -----------------------------
  const projects = new PrismaProjectRepository(db, audit);
  const policies = new PrismaPolicyRepository(db);
  const playbooks = new PrismaPlaybookRepository(db);
  // O limite do SISTEMA que o S.O encontra vira pauta de suporte do admin.
  const support = new PrismaSupportRepository(db);
  const conversations = new PrismaHubConversationRepository(db);
  const hubOperations = new PrismaHubOperationRepository(db);

  const brands = new PrismaBrandIdentityRepository(db, audit);
  // Uma porta só para gravar a marca: a tela e o S.O passam por aqui.
  const applyBrandIdentity = new ApplyBrandIdentityUseCase({ brands, projects, ids });
  const knowledgeRepo = new PrismaKnowledgeRepository(db);
  const retriever = new KeywordKnowledgeRetriever();
  const knowledge = new ManageKnowledgeUseCase({
    knowledge: knowledgeRepo,
    reader: new HttpWebContentReader(logger),
    ids,
    audit,
  });

  // Conversas (Fase 8). UMA instância para os DOIS canais: o Lab e o chat
  // público gravam pela mesma porta, e dois serviços fariam a próxima
  // correção chegar só em um deles.
  const sessions = new PrismaSessionRepository(db);
  // A evidência de campo: o que falhou em conversa REAL. É o que separa o OS
  // diagnosticar com prova de diagnosticar por suposição.
  const evidence = new PrismaEvidenceReader(db);
  const conversationService = new ConversationService({ sessions, ids });
  const adherence = new SemanticAdherenceValidator({ gateway, logger });

  const agents = new PrismaAgentRepository(db, audit);
  const campaigns = new PrismaCampaignRepository(db, audit);
  const media = new PrismaMediaRepository(db);
  // `local` não sobrevive a uma função serverless (`/tmp` é efêmero) — é por
  // isso que existe a segunda opção, não porque um dia vá substituir a
  // primeira: continua sendo o certo para rodar fora da Vercel.
  const mediaStorage =
    env.STORAGE_DRIVER === 'vercel-blob'
      ? new VercelBlobMediaStorage()
      : new LocalFileMediaStorage(env.MEDIA_DIR);

  // UM registro de alvos, dois consumidores: o runner (LLM propõe) e a edição
  // manual (o usuário propõe). Duplicar isso deixaria os dois caminhos
  // divergirem no primeiro agregado novo.
  const targets: Record<
    'PROJECT_PROFILE' | 'PROJECT_BRAND_IDENTITY' | 'AGENT' | 'CAMPAIGN' | 'PLAYBOOK',
    AnyOperationTarget
  > = {
    // Recebe campanhas e agentes: o OS precisa LER o projeto inteiro para
    // analisar. O que ele MUTA continua sendo só o perfil.
    PROJECT_PROFILE: new ProjectProfileTarget(
      projects,
      ids,
      campaigns,
      agents,
    ) as unknown as AnyOperationTarget,
    // Quinto alvo, e o que prova a abstração pelo lado oposto ao do playbook:
    // o runner não precisa saber que este documento NÃO TEM FACETAS.
    PROJECT_BRAND_IDENTITY: new BrandIdentityTarget(
      brands,
      projects,
      ids,
    ) as unknown as AnyOperationTarget,
    AGENT: new AgentTarget(agents, ids, evidence) as unknown as AnyOperationTarget,
    CAMPAIGN: new CampaignTarget(campaigns, projects, agents, ids) as unknown as AnyOperationTarget,
    // Quarto alvo, e o que prova a abstração: o runner não sabe que este é de
    // plataforma, não de conta.
    PLAYBOOK: new PlaybookTarget(playbooks, audit) as unknown as AnyOperationTarget,
  };

  const usageRead = new PrismaAiCallReadRepository(db);
  // A cotação é de EXIBIÇÃO e vem do PTAX: uma busca por dia, servida de
  // memória, nunca no caminho da requisição do usuário.
  const exchangeRate = new PtaxExchangeRateProvider({ logger });

  // UMA instância: o painel, a edição manual e a sincronização pelo ofício
  // escrevem no canônico pela mesma porta (§7.2).
  const applyManual = new ApplyManualMutationsUseCase({ targets, audit, ids, clock });

  // Tudo o que existe na conta, para o S.O resolver de que coisa o usuário
  // falou sem depender da tela em que ele está.
  // O veredito da conferência do Lab espera aqui até a tela buscá-lo.
  const pendingAdherence = new PendingAdherence();

  // As ações da tela que não são documento versionado. UM use case por ação,
  // chamado pela rota E pelo S.O — ver `system-action.ts`.
  const bindAgent = new BindCampaignAgentUseCase({ campaigns });
  const publish = new PublishCampaignUseCase({
    campaigns,
    projects,
    brands,
    knowledge,
    agents,
    router,
    ids,
  });
  const syncCraft = new SyncAgentCraftUseCase({ agents, playbooks, applyManual });
  const deleteAgent = new DeleteAgentUseCase({ agents, campaigns, audit });
  const changeModel = new ChangeModelRouteUseCase({ store: modelRoutes, providers, audit });
  const manageProviderCredentials = new ManageProviderCredentialsUseCase({
    repository: providerCredentialRepository,
    registry: providerRegistry,
    cipher: credentialCipher,
    testKey: testProviderKey,
    audit,
  });

  const accountInventory = new AccountInventoryReader({
    projects,
    agents,
    campaigns,
    playbooks,
    knowledge: knowledgeRepo,
  });

  const runner = new MyAIHubOperationRunner({
    inventory: accountInventory,
    policies,
    playbooks,
    conversations,
    operations: hubOperations,
    targets,
    gateway,
    bus: eventBus,
    audit,
    ids,
    clock,
    logger,
    web: new HttpWebContentReader(logger),
    media,
    storage: mediaStorage,
    // O S.O testa o agente que acabou de configurar, antes de entregar.
    rehearsal: new AgentRehearsalService({ agents, sessions, gateway }),
    support,
    // A identidade visual lida do site, pela MESMA porta da tela da marca.
    brand: applyBrandIdentity,
    actions: new SystemActionExecutor({
      bindAgent,
      publish,
      syncCraft,
      deleteAgent,
      knowledge,
      changeModel,
    }),
  });

  return {
    db,
    logger,
    clock,
    ids,
    hasher,
    tokens,
    audit,
    eventBus,
    identity,
    ai: { providers, router, gateway, modelRoutes, servedTier, providerRegistry },
    providerCredentials: {
      tokens,
      repository: providerCredentialRepository,
      providers,
      cipher: credentialCipher,
      manage: manageProviderCredentials,
    },
    usage: { read: usageRead, exchangeRate },
    projects: { projects, tokens },
    projectAssets: { tokens, projects, brands, knowledge, ids },
    conversations: { tokens, sessions, pending: pendingAdherence },
    models: { tokens, store: modelRoutes, providers, change: changeModel },
    metrics: {
      tokens,
      metrics: new PrismaMetricsRepository(db),
      usage: usageRead,
      exchangeRate,
      // Só o adapter do Gemini tem duas cotas; o Fake e os indisponíveis não
      // têm nem uma. Por isso a leitura é opcional e não entra na porta do
      // provider: seria um método que quase toda implementação não teria o que
      // responder.
      quotaStatus: () => {
        const gemini = providers.get('gemini');
        return gemini instanceof GeminiProvider ? gemini.keyStatus() : null;
      },
    },
    agents: {
      agents,
      tokens,
      playbooks,
      syncCraft,
      deleteAgent,
      testAgent: new TestAgentUseCase({
        // O veredito da conferência espera aqui até a tela buscá-lo: ele deixou
        // de segurar a resposta do agente.
        pending: pendingAdherence,
        logger,
        agents,
        campaigns,
        projects,
        brands,
        knowledge: knowledgeRepo,
        retriever,
        conversations: conversationService,
        adherence,
        gateway,
      }),
      planBriefing: new PlanAgentBriefingUseCase({ gateway, policies, playbooks }),
    },
    campaigns: {
      tokens,
      campaigns,
      agents,
      publish,
      bindAgent,
    },
    media: { tokens, media, storage: mediaStorage, ids },
    publicChat: {
      publicChat: new PublicChatUseCase({
        lookup: new PrismaPublicDeploymentLookup(db),
        gateway,
        conversations: conversationService,
        knowledge: knowledgeRepo,
        retriever,
        adherence,
      }),
    },
    manualEdit: { tokens, applyManual },
    admin: {
      tokens,
      playbooks,
      support,
      audit,
      distill: new DistillPlaybookUseCase({ gateway, policies }),
      revise: new RevisePlaybookUseCase({ gateway, policies }),
    },
    hub: {
      tokens,
      conversations,
      operations: hubOperations,
      runner,
      // Quem decide QUAL operação o pedido do usuário exige. Fora do runner de
      // propósito: a escolha precisa acontecer antes de a operação ser
      // registrada, senão o painel anuncia um rótulo e roda outra coisa.
      router: new RouteHubRequestUseCase({ gateway, inventory: accountInventory }),
      bus: eventBus,
      ids,
      policies,
      playbooks,
      attachments: async (context, assetIds) => {
        const assets = await media.findManyByIds(context, assetIds);
        return assets.map((asset) => ({
          id: asset.id,
          url: `/api/media/${asset.id}`,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          width: asset.width,
          height: asset.height,
        }));
      },
    },
  };
}
