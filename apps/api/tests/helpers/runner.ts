import { PlaybookTarget } from '../../src/modules/myaihub/infrastructure/playbook-target.js';
import { LlmGateway } from '../../src/modules/ai/application/llm-gateway.js';
import { ModelRouter } from '../../src/modules/ai/application/model-router.js';
import type { FakeProvider } from '../../src/modules/ai/infrastructure/providers/fake-provider.js';
import { PrismaAgentRepository } from '../../src/modules/agents/infrastructure/prisma-agent.repository.js';
import { AccountInventoryReader } from '../../src/modules/myaihub/application/account-inventory.js';
import { PrismaCampaignRepository } from '../../src/modules/campaigns/infrastructure/prisma-campaign.repository.js';
import type { MediaStorage } from '../../src/modules/media/domain/media.js';
import { PrismaMediaRepository } from '../../src/modules/media/infrastructure/media.infrastructure.js';
import {
  MyAIHubOperationRunner,
  type AnyOperationTarget,
} from '../../src/modules/myaihub/application/operation-runner.js';
import {
  AgentTarget,
  CampaignTarget,
  ProjectProfileTarget,
} from '../../src/modules/myaihub/infrastructure/operation-targets.js';
import {
  PrismaHubConversationRepository,
  PrismaHubOperationRepository,
  PrismaPlaybookRepository,
  PrismaSupportRepository,
  PrismaPolicyRepository,
} from '../../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import { PrismaProjectRepository } from '../../src/modules/projects/infrastructure/prisma-project.repository.js';
import { PrismaBrandIdentityRepository } from '../../src/modules/projects/infrastructure/prisma-brand-identity.repository.js';
import { PrismaKnowledgeRepository } from '../../src/modules/projects/infrastructure/prisma-knowledge.repository.js';
import { BrandIdentityTarget } from '../../src/modules/projects/infrastructure/brand-identity.target.js';
import { ManageKnowledgeUseCase } from '../../src/modules/projects/application/manage-knowledge.use-case.js';
import { KeywordKnowledgeRetriever } from '../../src/modules/projects/domain/knowledge-retriever.js';
import { PrismaSessionRepository } from '../../src/modules/conversations/infrastructure/prisma-conversation.repository.js';
import { PrismaEvidenceReader } from '../../src/modules/conversations/infrastructure/prisma-evidence.reader.js';
import { ConversationService } from '../../src/modules/conversations/application/conversation.service.js';
import { SemanticAdherenceValidator } from '../../src/modules/conversations/application/adherence-validator.js';
import { RecordAiCallUseCase } from '../../src/modules/usage/application/record-ai-call.use-case.js';
import {
  PrismaAiCallRepository,
  PrismaPricingRepository,
} from '../../src/modules/usage/infrastructure/prisma-usage.repositories.js';
import type { AgentRehearsal } from '../../src/modules/myaihub/application/agent-rehearsal.js';
import { SystemActionExecutor } from '../../src/modules/myaihub/application/system-action-executor.js';
import { SyncAgentCraftUseCase } from '../../src/modules/myaihub/application/sync-agent-craft.use-case.js';
import { ApplyManualMutationsUseCase } from '../../src/modules/myaihub/application/apply-manual-mutations.use-case.js';
import { BindCampaignAgentUseCase } from '../../src/modules/campaigns/application/bind-campaign-agent.use-case.js';
import { PublishCampaignUseCase } from '../../src/modules/campaigns/application/publish-campaign.use-case.js';
import { DeleteAgentUseCase } from '../../src/modules/agents/application/delete-agent.use-case.js';
import type { Logger, WebContent, WebContentReader } from '../../src/shared/application/ports.js';
import { PrismaAuditWriter } from '../../src/shared/infrastructure/audit/prisma-audit-writer.js';
import { InMemoryEventBus } from '../../src/shared/infrastructure/events/in-memory-event-bus.js';
import { SystemClock, UlidGenerator } from '../../src/shared/infrastructure/system-clock.js';
import { rawDb } from './test-context.js';

/**
 * Monta o runner completo para os testes de integração.
 *
 * Existe porque a montagem estava copiada em cada arquivo de teste — e o
 * registro de alvos, que é o ponto de extensão do runner, ficava desatualizado
 * em silêncio a cada agregado novo. Aqui, adicionar um alvo é um lugar só.
 */
export const SILENT_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => ({}) as never,
};

/**
 * Leitor web dos testes.
 *
 * Devolve o que foi registrado em `pages` e `null` para o resto. Nenhum teste
 * toca a rede — o mesmo motivo pelo qual o FakeProvider é permanente.
 */
export class FakeWebContentReader implements WebContentReader {
  readonly pages = new Map<string, WebContent>();
  readonly requested: string[] = [];

  serve(url: string, text: string, title = 'Página'): void {
    this.pages.set(url, { url, title, text, truncated: false });
  }

  read(url: string): Promise<WebContent | null> {
    this.requested.push(url);
    return Promise.resolve(this.pages.get(url) ?? null);
  }
}

/**
 * Storage de mídia em memória.
 *
 * Nenhum teste escreve no disco: um arquivo esquecido entre execuções faria um
 * teste passar por causa do lixo do anterior.
 */
export class FakeMediaStorage implements MediaStorage {
  readonly files = new Map<string, Buffer>();

  put(accountId: string, assetId: string, mimeType: string, bytes: Buffer): Promise<string> {
    const key = `${accountId}/${assetId}`;
    this.files.set(key, bytes);
    return Promise.resolve(key);
  }

  get(storageKey: string): Promise<Buffer | null> {
    return Promise.resolve(this.files.get(storageKey) ?? null);
  }

  delete(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
    return Promise.resolve();
  }
}

export interface TestRunnerHarness {
  runner: MyAIHubOperationRunner;
  gateway: LlmGateway;
  conversations: PrismaHubConversationRepository;
  operations: PrismaHubOperationRepository;
  policies: PrismaPolicyRepository;
  playbooks: PrismaPlaybookRepository;
  projects: PrismaProjectRepository;
  brands: PrismaBrandIdentityRepository;
  /** O repositório cru — o que os runtimes consomem para LER conhecimento. */
  knowledgeRepo: PrismaKnowledgeRepository;
  /** O caso de uso — o que a publicação usa para CONGELAR um snapshot. */
  knowledge: ManageKnowledgeUseCase;
  retriever: KeywordKnowledgeRetriever;
  sessions: PrismaSessionRepository;
  conversationService: ConversationService;
  adherence: SemanticAdherenceValidator;
  agents: PrismaAgentRepository;
  campaigns: PrismaCampaignRepository;
  bus: InMemoryEventBus;
  ids: UlidGenerator;
  clock: SystemClock;
  web: FakeWebContentReader;
  media: PrismaMediaRepository;
  storage: FakeMediaStorage;
}

export function createTestRunner(
  provider: FakeProvider,
  /**
   * O ensaio do agente, quando o teste quiser observá-lo.
   *
   * Dublê e não o serviço real: o que se testa aqui é o que o RUNNER faz com o
   * veredito — anunciar sucesso ou dizer que o erro continua —, e amarrar isso
   * ao provider dublê tornaria o teste sobre outra coisa.
   */
  rehearsal?: AgentRehearsal,
): TestRunnerHarness {
  const db = rawDb as never;
  const ids = new UlidGenerator();
  const clock = new SystemClock();
  const bus = new InMemoryEventBus();
  const audit = new PrismaAuditWriter(db, ids);
  const web = new FakeWebContentReader();
  const media = new PrismaMediaRepository(db);
  const storage = new FakeMediaStorage();

  const projects = new PrismaProjectRepository(db, audit);
  const agents = new PrismaAgentRepository(db, audit);
  const campaigns = new PrismaCampaignRepository(db, audit);
  const conversations = new PrismaHubConversationRepository(db);
  const operations = new PrismaHubOperationRepository(db);
  const policies = new PrismaPolicyRepository(db);
  const playbooks = new PrismaPlaybookRepository(db);

  const router = new ModelRouter(
    {
      'hub.reasoning': { provider: 'fake', model: 'fake-1' },
      'hub.fast': { provider: 'fake', model: 'fake-1' },
      'agent.runtime': { provider: 'fake', model: 'fake-1' },
      'validation.fast': { provider: 'fake', model: 'fake-1' },
      'analysis.vision': { provider: 'fake', model: 'fake-1' },
    },
    new Map([['fake', provider]]),
  );

  const gateway = new LlmGateway(
    router,
    new RecordAiCallUseCase(
      new PrismaAiCallRepository(db),
      new PrismaPricingRepository(db),
      ids,
      clock,
    ),
  );

  const brands = new PrismaBrandIdentityRepository(db, audit);
  const knowledgeRepo = new PrismaKnowledgeRepository(db);
  const retriever = new KeywordKnowledgeRetriever();
  const knowledge = new ManageKnowledgeUseCase({
    knowledge: knowledgeRepo,
    reader: web,
    ids,
    audit,
  });

  const sessions = new PrismaSessionRepository(db);
  const conversationService = new ConversationService({ sessions, ids });
  const adherence = new SemanticAdherenceValidator({ gateway, logger: SILENT_LOGGER });

  const targets = {
    PLAYBOOK: new PlaybookTarget(playbooks, audit) as unknown as AnyOperationTarget,
    PROJECT_PROFILE: new ProjectProfileTarget(
      projects,
      ids,
      campaigns,
      agents,
    ) as unknown as AnyOperationTarget,
    PROJECT_BRAND_IDENTITY: new BrandIdentityTarget(
      brands,
      projects,
      ids,
    ) as unknown as AnyOperationTarget,
    AGENT: new AgentTarget(
      agents,
      ids,
      new PrismaEvidenceReader(db),
    ) as unknown as AnyOperationTarget,
    CAMPAIGN: new CampaignTarget(campaigns, projects, agents, ids) as unknown as AnyOperationTarget,
  };

  // As ações do sistema pelos MESMOS use cases do container. Trocar modelo
  // fica de fora: ele mexe numa rota de plataforma que a suíte não monta, e o
  // dublê falha alto em vez de fingir que trocou.
  const actions = new SystemActionExecutor({
    bindAgent: new BindCampaignAgentUseCase({ campaigns }),
    publish: new PublishCampaignUseCase({
      campaigns,
      projects,
      brands,
      knowledge,
      agents,
      router,
      ids,
    }),
    syncCraft: new SyncAgentCraftUseCase({
      agents,
      playbooks,
      applyManual: new ApplyManualMutationsUseCase({ targets, audit, ids, clock }),
    }),
    deleteAgent: new DeleteAgentUseCase({ agents, campaigns, audit }),
    knowledge,
    changeModel: {
      execute: () => Promise.reject(new Error('trocar modelo não é montado na suíte')),
    } as never,
  });

  const runner = new MyAIHubOperationRunner({
    // O panorama da conta entra em toda operação: é o que faz o S.O enxergar o
    // que existe fora da tela em que o usuário está.
    inventory: new AccountInventoryReader({
      projects,
      agents,
      campaigns,
      playbooks,
      knowledge: knowledgeRepo,
    }),
    policies,
    playbooks,
    conversations,
    operations,
    targets,
    gateway,
    bus,
    audit,
    ids,
    clock,
    logger: SILENT_LOGGER,
    web,
    media,
    storage,
    ...(rehearsal ? { rehearsal } : {}),
    actions,
    support: new PrismaSupportRepository(db),
  });

  return {
    runner,
    gateway,
    conversations,
    brands,
    knowledgeRepo,
    knowledge,
    retriever,
    sessions,
    conversationService,
    adherence,
    operations,
    policies,
    playbooks,
    projects,
    agents,
    campaigns,
    bus,
    ids,
    clock,
    web,
    media,
    storage,
  };
}
