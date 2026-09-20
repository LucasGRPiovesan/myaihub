import {
  AGENT_FACET_CODES,
  CAMPAIGN_FACET_CODES,
  PROJECT_FACET_CODES,
  countAgentItems,
  countCampaignItems,
  emptyAgent,
  emptyCampaign,
  emptyProjectProfile,
  summarizeAgent,
  summarizeCampaign,
  summarizeProjectProfile,
  type CanonicalAgent,
  type CanonicalCampaign,
  type CanonicalProjectProfile,
} from '@myaihub/shared';
import type { IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { ContextBlock } from '../../ai/domain/context.js';
import { AgentMutationApplier } from '../../agents/domain/mutation-applier.js';
import type { AgentMutation, AgentMutationKind } from '../../agents/domain/mutations.js';
import type { AgentRepository } from '../../agents/domain/repositories.js';
import type { EvidenceReader } from '../../conversations/domain/evidence.js';
import { CampaignMutationApplier } from '../../campaigns/domain/mutation-applier.js';
import type { CampaignMutation, CampaignMutationKind } from '../../campaigns/domain/mutations.js';
import type { CampaignRepository } from '../../campaigns/domain/repositories.js';
import { AppError } from '../../../shared/domain/errors.js';
import type { ProjectRepository } from '../../projects/domain/repositories.js';
import type { MutationContext } from '../domain/mutation-applier.js';
import { ProjectProfileMutationApplier } from '../domain/mutation-applier.js';
import type { CanonicalMutation, CanonicalMutationKind } from '../domain/mutations.js';
import { promptJson } from '../domain/prompt-json.js';
import type {
  LoadedTarget,
  OperationTarget,
  PersistInput,
  PersistedTarget,
} from '../domain/operation-target.js';

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return slug || fallback;
}

// -----------------------------------------------------------------------------
// Project Profile
// -----------------------------------------------------------------------------

export class ProjectProfileTarget implements OperationTarget<
  CanonicalProjectProfile,
  CanonicalMutation,
  CanonicalMutationKind
> {
  readonly entityType = 'PROJECT_PROFILE';
  private readonly applier = new ProjectProfileMutationApplier();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly ids: IdGenerator,
    private readonly campaigns: CampaignRepository,
    private readonly agents: AgentRepository,
  ) {}

  /**
   * O PROJETO INTEIRO, para o OS poder analisar em vez de adivinhar.
   *
   * Ele enxergava só o perfil, e isso limitava o que ele conseguia responder a
   * uma pergunta simples: "o que falta neste projeto?". Sem as campanhas ele
   * não sabe o que já está sendo cobrado do perfil; sem os agentes ele não sabe
   * a quem uma regra de negócio nova vai passar a valer — e é justamente essa
   * frase que o usuário precisa ler para saber se tem de republicar algo.
   *
   * Vai como KNOWLEDGE e não como STABLE: é contexto de LEITURA. O alvo da
   * operação continua sendo o perfil, e só ele é mutável.
   */
  async relatedContext(
    context: TenantContext,
    ids: { parentId: string | null; entityId: string | null },
  ): Promise<ContextBlock[]> {
    const projectId = ids.entityId ?? ids.parentId;
    if (!projectId) return [];

    const campanhas = await this.campaigns.list(context, { projectId }, 20, null);

    // Um agente pode servir várias campanhas do mesmo projeto: o conjunto
    // responde "a quem isto passa a valer", que é o que interessa aqui.
    const agentIds = [...new Set(campanhas.map((c) => c.agentId).filter(Boolean))] as string[];
    const agentes = await Promise.all(agentIds.map((id) => this.agents.findById(context, id)));

    const linhas: string[] = [];

    linhas.push(
      campanhas.length > 0
        ? 'CAMPANHAS DESTE PROJETO — o que já usa este perfil hoje:'
        : 'CAMPANHAS DESTE PROJETO: nenhuma ainda.',
    );
    for (const campanha of campanhas) {
      const agente = agentes.find((a) => a?.agent.id === campanha.agentId);
      linhas.push(
        `  ${campanha.name} — ${campanha.status}` +
          (agente ? `, conduzida por ${agente.agent.name}` : ', sem agente vinculado'),
      );
    }

    linhas.push(
      '',
      agentes.length > 0
        ? 'AGENTES QUE ATUAM NESTE PROJETO — toda regra de negócio HARD do perfil'
        : 'AGENTES QUE ATUAM NESTE PROJETO: nenhum ainda.',
    );
    if (agentes.length > 0) {
      linhas.push(
        'passa a valer para eles como regra inegociável, na próxima conversa — e nas',
        'campanhas que já estão no ar, a partir da próxima publicação.',
        '',
      );
    }
    for (const encontrado of agentes) {
      if (!encontrado) continue;
      const canonico = encontrado.version?.canonicalConfig;
      linhas.push(
        `  ${encontrado.agent.name}` +
          (canonico?.identity.role ? ` — ${canonico.identity.role}` : '') +
          (canonico?.objective.primary ? `. Objetivo: ${canonico.objective.primary}` : ''),
      );
    }

    /*
      OS DEMAIS AGENTES DA CONTA — os que existem e ainda não atuam aqui.

      Sem esta lista o OS enxergava só quem já estava vinculado a uma campanha,
      e a ausência virava AFIRMAÇÃO: perguntado "qual agente você indica pra
      esse projeto?", ele respondeu "ainda não há nenhum agente criado na conta"
      e propôs criar um — com o agente já pronto, configurado e testado na conta
      do usuário. Recomendar um agente que existe é impossível para quem não o
      vê, e o custo do erro é um agente DUPLICADO, que a partir daí recebe
      metade das correções.

      O vínculo em si continua sendo ato explícito, e ele acontece na CAMPANHA:
      é lá que se decide quem fala com o cliente. O que muda aqui é só o OS
      poder dizer "use o Alex" em vez de inventar um segundo.
    */
    const daConta = await this.agents.list(context, 20, null);
    const disponiveis = daConta.filter((agente) => !agentIds.includes(agente.id));
    if (disponiveis.length > 0) {
      linhas.push(
        '',
        'OUTROS AGENTES DESTA CONTA — existem e ainda não atuam neste projeto.',
        'Se o usuário perguntar qual agente usar, INDIQUE UM DESTES em vez de propor',
        'criar outro; um agente serve qualquer projeto, e o vínculo é feito ao',
        'criar ou editar a campanha que ele vai conduzir.',
      );
      for (const agente of disponiveis) {
        linhas.push(`  ${agente.name} — ${agente.role}`);
      }
    }

    // O rastro do próprio perfil. Mesma razão do `agent.attempts`: sem ver o que
    // já foi tentado, a análise repete a correção que não funcionou.
    const versoes = await this.projects.listVersions(context, projectId, 8);
    if (versoes.length > 1) {
      linhas.push('', 'O QUE JÁ FOI FEITO NESTE PERFIL, do mais recente para o mais antigo:');
      for (const versao of versoes) linhas.push(`  v${versao.versionNumber} — ${versao.reason}`);
    }

    return [
      {
        id: 'project.workspace',
        kind: 'KNOWLEDGE',
        trust: 'TRUSTED',
        priority: 70,
        cacheable: false,
        content: linhas.join('\n'),
      },
    ];
  }

  async load(
    context: TenantContext,
    targetId: string,
  ): Promise<LoadedTarget<CanonicalProjectProfile> | null> {
    const found = await this.projects.findById(context, targetId);
    if (!found) return null;

    return {
      entityId: found.project.id,
      canonical: found.profile?.canonicalConfig ?? this.empty(),
      versionId: found.profile?.id ?? null,
      versionNumber: found.profile?.versionNumber ?? null,
      lockVersion: found.project.lockVersion,
      displayName: found.project.name,
    };
  }

  empty(): CanonicalProjectProfile {
    return emptyProjectProfile('Novo projeto');
  }

  facets(): readonly string[] {
    return Object.keys(PROJECT_FACET_CODES);
  }

  applyMutations(
    current: CanonicalProjectProfile,
    mutations: CanonicalMutation[],
    mutationContext: MutationContext<CanonicalMutationKind>,
  ) {
    return this.applier.apply(current, mutations, mutationContext);
  }

  summarize(canonical: CanonicalProjectProfile): string[] {
    return summarizeProjectProfile(canonical);
  }

  contextBlock(canonical: CanonicalProjectProfile, versionId: string | null): ContextBlock {
    return {
      id: 'project.profile',
      kind: 'STABLE',
      trust: 'TRUSTED',
      priority: 80,
      // O alvo da operação NUNCA sai por orçamento: sem ele o OS reescreve
      // no escuro, e o corte é silencioso.
      essential: true,
      cacheable: true,
      content: promptJson(canonical),
      ...(versionId ? { sourceVersionId: versionId } : {}),
    };
  }

  async persist(
    context: TenantContext,
    input: PersistInput<CanonicalProjectProfile, CanonicalMutation>,
  ): Promise<PersistedTarget> {
    const change = {
      id: this.ids.generate(),
      entityType: 'PROJECT_PROFILE' as const,
      source: 'MYAIHUB' as const,
      actorUserId: context.userId,
      hubOperationId: input.hubOperationId,
      hubMessageId: input.hubMessageId,
      interpretedIntent: input.interpretedIntent,
      mutations: input.mutations,
      rationale: input.rationale,
    };

    if (input.existing) {
      const saved = await this.projects.updateProfile(context, {
        projectId: input.existing.entityId,
        expectedLockVersion: input.existing.lockVersion,
        profileVersion: {
          id: this.ids.generate(),
          canonicalConfig: input.canonical,
          humanSummary: input.humanSummary,
          source: 'MYAIHUB',
          reason: input.interpretedIntent,
        },
        change: {
          ...change,
          fromVersionId: input.existing.versionId,
          fromVersion: input.existing.versionNumber,
        },
        audit: {
          accountId: context.accountId,
          actorUserId: context.userId,
          action: 'project.profile_updated',
          entityType: 'Project',
          entityId: input.existing.entityId,
          metadata: { intent: input.interpretedIntent },
        },
      });

      return {
        entityId: saved.project.id,
        versionNumber: saved.profile?.versionNumber ?? 1,
        displayName: saved.project.name,
      };
    }

    const saved = await this.projects.create(context, {
      project: {
        id: this.ids.generate(),
        name: input.canonical.name,
        slugBase: slugify(input.canonical.name, 'projeto'),
        createdBy: context.userId ?? 'system',
      },
      profileVersion: {
        id: this.ids.generate(),
        canonicalConfig: input.canonical,
        humanSummary: input.humanSummary,
        source: 'MYAIHUB',
        reason: input.interpretedIntent,
      },
      capability: { id: this.ids.generate(), type: 'CAMPAIGNS' },
      change,
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: 'project.created',
        entityType: 'Project',
        metadata: { intent: input.interpretedIntent },
      },
    });

    return {
      entityId: saved.project.id,
      versionNumber: saved.profile?.versionNumber ?? 1,
      displayName: saved.project.name,
    };
  }
}

// -----------------------------------------------------------------------------
// Agent Core
// -----------------------------------------------------------------------------

export class AgentTarget implements OperationTarget<
  CanonicalAgent,
  AgentMutation,
  AgentMutationKind
> {
  readonly entityType = 'AGENT';
  readonly levelBoundary = ['PROJECT', 'CAMPAIGN'] as const;
  private readonly applier = new AgentMutationApplier();

  constructor(
    private readonly agents: AgentRepository,
    private readonly ids: IdGenerator,
    private readonly evidence: EvidenceReader,
  ) {}

  /**
   * O que JÁ FOI TENTADO neste agente.
   *
   * O OS não enxergava o próprio rastro e reescrevia a mesma correção sem saber.
   * Medido no banco: nove versões seguidas do mesmo princípio, cada uma com
   * outras palavras para a mesma ideia abstrata — "sem saltar para conclusões",
   * "sem atropelar o cenário", "evita premissas incorretas" —, nenhuma efetiva.
   * O usuário repetia a queixa e recebia a décima paráfrase.
   *
   * Com o histórico no contexto, reescrever pela enésima vez deixa de ser uma
   * opção invisível: a instrução manda mudar a FORMA quando a mesma coisa já
   * falhou antes. É análise, e é o próprio trabalho do OS — não dá para pedir
   * que ele a faça com os olhos fechados.
   */
  async relatedContext(
    context: TenantContext,
    ids: { parentId: string | null; entityId: string | null },
  ): Promise<ContextBlock[]> {
    if (!ids.entityId) return [];

    const blocos: ContextBlock[] = [];

    const versoes = await this.agents.listVersions(context, ids.entityId, 8);

    // Uma versão só é a criação: não há tentativa anterior para analisar.
    if (versoes.length >= 2) {
      blocos.push({
        id: 'agent.attempts',
        kind: 'KNOWLEDGE',
        trust: 'TRUSTED',
        priority: 60,
        cacheable: false,
        content: [
          'O QUE JÁ FOI TENTADO NESTE AGENTE, do mais recente para o mais antigo:',
          '',
          ...versoes.map((versao) => `  v${versao.versionNumber} — ${versao.reason}`),
        ].join('\n'),
      });
    }

    // A EVIDÊNCIA DE CAMPO: o que falhou com gente de verdade.
    //
    // Até aqui o OS diagnosticava com uma mão amarrada — lia o transcrito do
    // LAB e nada mais. As conversas públicas estavam no banco desde a Fase 8 e
    // as violações contadas desde a Fase 10, e a única forma de ele saber
    // disso era o usuário narrar.
    //
    // É a diferença entre "acho que ele promete prazo" e "esta regra falhou 4
    // vezes, aqui está a fala". Diante da primeira ele reescreve no escuro —
    // foi o que produziu nove versões seguidas do mesmo ofício tentando a
    // mesma correção.
    const violacoes = await this.evidence.violationsByAgent(context, ids.entityId, 5);

    if (violacoes.length > 0) {
      blocos.push({
        id: 'agent.field_evidence',
        kind: 'KNOWLEDGE',
        trust: 'TRUSTED',
        priority: 75,
        // Essencial QUANDO EXISTE: é a única prova de que uma regra não pega.
        // Cortada por orçamento, o OS volta a corrigir por suposição.
        essential: true,
        cacheable: false,
        content: [
          'O QUE ESTÁ FALHANDO EM PRODUÇÃO — conversas reais, não teste.',
          '',
          'Violação de regra marcada como obrigatória é falha NOSSA, não',
          'configuração ruim do usuário. Se a mesma regra reaparece aqui, ela já',
          'existe e não está pegando: o problema é a FORMA — abstrata demais,',
          'enforcement fraco, ou outra regra competindo. Não acrescente uma quarta',
          'formulação; torne a EXISTENTE concreta.',
          '',
          ...violacoes
            .flatMap((violacao) => [
              `[${violacao.check}] falhou ${violacao.count}× — caso mais recente:`,
              violacao.sample.prompt ? `  INTERLOCUTOR: ${violacao.sample.prompt}` : null,
              `  AGENTE: ${violacao.sample.reply}`,
              '',
            ])
            .filter((linha): linha is string => linha !== null),
        ].join('\n'),
      });
    }

    return blocos;
  }

  async load(
    context: TenantContext,
    targetId: string,
  ): Promise<LoadedTarget<CanonicalAgent> | null> {
    const found = await this.agents.findById(context, targetId);
    if (!found) return null;

    return {
      entityId: found.agent.id,
      canonical: found.version?.canonicalConfig ?? emptyAgent(found.agent.name),
      versionId: found.version?.id ?? null,
      versionNumber: found.version?.versionNumber ?? null,
      lockVersion: found.agent.lockVersion,
      displayName: found.agent.name,
    };
  }

  empty(): CanonicalAgent {
    return emptyAgent('Novo agente');
  }

  facets(): readonly string[] {
    return Object.keys(AGENT_FACET_CODES);
  }

  applyMutations(
    current: CanonicalAgent,
    mutations: AgentMutation[],
    mutationContext: MutationContext<AgentMutationKind>,
  ) {
    return this.applier.apply(current, mutations, mutationContext);
  }

  summarize(canonical: CanonicalAgent): string[] {
    return summarizeAgent(canonical);
  }

  contextBlock(canonical: CanonicalAgent, versionId: string | null): ContextBlock {
    return {
      id: 'agent.core',
      kind: 'STABLE',
      trust: 'TRUSTED',
      priority: 85,
      // O alvo da operação NUNCA sai por orçamento: sem ele o OS reescreve
      // no escuro, e o corte é silencioso.
      essential: true,
      cacheable: true,
      // JSON completo: o modelo precisa ver os `semanticKey` existentes para
      // refinar em vez de criar item novo dizendo a mesma coisa (§5.1).
      content: promptJson(canonical),
      ...(versionId ? { sourceVersionId: versionId } : {}),
    };
  }

  async persist(
    context: TenantContext,
    input: PersistInput<CanonicalAgent, AgentMutation>,
  ): Promise<PersistedTarget> {
    const change = {
      id: this.ids.generate(),
      entityType: 'AGENT' as const,
      source: 'MYAIHUB' as const,
      actorUserId: context.userId,
      hubOperationId: input.hubOperationId,
      hubMessageId: input.hubMessageId,
      interpretedIntent: input.interpretedIntent,
      mutations: input.mutations,
      rationale: input.rationale,
    };

    if (input.existing) {
      const saved = await this.agents.updateConfiguration(context, {
        agentId: input.existing.entityId,
        expectedLockVersion: input.existing.lockVersion,
        version: {
          id: this.ids.generate(),
          canonicalConfig: input.canonical,
          humanSummary: input.humanSummary,
          source: 'MYAIHUB',
          reason: input.interpretedIntent,
        },
        change: {
          ...change,
          fromVersionId: input.existing.versionId,
          fromVersion: input.existing.versionNumber,
        },
        audit: {
          accountId: context.accountId,
          actorUserId: context.userId,
          action: 'agent.configured',
          entityType: 'Agent',
          entityId: input.existing.entityId,
          metadata: {
            intent: input.interpretedIntent,
            items: countAgentItems(input.canonical),
          },
        },
      });

      return {
        entityId: saved.agent.id,
        versionNumber: saved.version?.versionNumber ?? 1,
        displayName: saved.agent.name,
      };
    }

    const saved = await this.agents.create(context, {
      agent: {
        id: this.ids.generate(),
        name: input.canonical.identity.name,
        slugBase: slugify(input.canonical.identity.name, 'agente'),
        role: input.canonical.identity.role,
        createdBy: context.userId ?? 'system',
      },
      version: {
        id: this.ids.generate(),
        canonicalConfig: input.canonical,
        humanSummary: input.humanSummary,
        source: 'MYAIHUB',
        reason: input.interpretedIntent,
      },
      change,
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: 'agent.created',
        entityType: 'Agent',
        metadata: { intent: input.interpretedIntent },
      },
    });

    return {
      entityId: saved.agent.id,
      versionNumber: saved.version?.versionNumber ?? 1,
      displayName: saved.agent.name,
    };
  }
}

// -----------------------------------------------------------------------------
// Campaign Strategy
// -----------------------------------------------------------------------------

export class CampaignTarget implements OperationTarget<
  CanonicalCampaign,
  CampaignMutation,
  CampaignMutationKind
> {
  readonly entityType = 'CAMPAIGN';
  private readonly applier = new CampaignMutationApplier();

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly projects: ProjectRepository,
    private readonly agents: AgentRepository,
    private readonly ids: IdGenerator,
  ) {}

  async load(
    context: TenantContext,
    targetId: string,
  ): Promise<LoadedTarget<CanonicalCampaign> | null> {
    const found = await this.campaigns.findById(context, targetId);
    if (!found) return null;

    return {
      entityId: found.campaign.id,
      canonical: found.version?.canonicalConfig ?? emptyCampaign(found.campaign.name),
      versionId: found.version?.id ?? null,
      versionNumber: found.version?.versionNumber ?? null,
      lockVersion: found.campaign.lockVersion,
      displayName: found.campaign.name,
    };
  }

  empty(): CanonicalCampaign {
    return emptyCampaign('Nova campanha');
  }

  facets(): readonly string[] {
    return Object.keys(CAMPAIGN_FACET_CODES);
  }

  applyMutations(
    current: CanonicalCampaign,
    mutations: CampaignMutation[],
    mutationContext: MutationContext<CampaignMutationKind>,
  ) {
    return this.applier.apply(current, mutations, mutationContext);
  }

  summarize(canonical: CanonicalCampaign): string[] {
    return summarizeCampaign(canonical);
  }

  contextBlock(canonical: CanonicalCampaign, versionId: string | null): ContextBlock {
    return {
      id: 'campaign.strategy',
      kind: 'STABLE',
      trust: 'TRUSTED',
      priority: 88,
      // O alvo da operação NUNCA sai por orçamento: sem ele o OS reescreve
      // no escuro, e o corte é silencioso.
      essential: true,
      cacheable: true,
      content: promptJson(canonical),
      ...(versionId ? { sourceVersionId: versionId } : {}),
    };
  }

  /**
   * Uma campanha não se explica sozinha.
   *
   * Ela existe dentro de um projeto (que define o negócio) e é executada por um
   * agente (que define quem fala). Sem os dois, o modelo escreveria uma
   * estratégia plausível para um negócio genérico — que é pior que nenhuma,
   * porque parece certa.
   */
  async relatedContext(
    context: TenantContext,
    ids: { parentId: string | null; entityId: string | null },
  ): Promise<ContextBlock[]> {
    const blocks: ContextBlock[] = [];

    // Na criação o projeto vem pelo pai; no refinamento, pela própria campanha.
    let projectId = ids.parentId;
    let agentId: string | null = null;

    if (ids.entityId) {
      const campaign = await this.campaigns.findById(context, ids.entityId);
      projectId = campaign?.campaign.projectId ?? projectId;
      agentId = campaign?.campaign.agentId ?? null;
    }

    if (projectId) {
      const project = await this.projects.findById(context, projectId);
      if (project?.profile) {
        blocks.push({
          id: 'project.profile',
          kind: 'STABLE',
          trust: 'TRUSTED',
          priority: 80,
          cacheable: true,
          content: promptJson(project.profile.canonicalConfig),
          sourceVersionId: project.profile.id,
        });
      }
    }

    if (agentId) {
      const agent = await this.agents.findById(context, agentId);
      if (agent?.version) {
        blocks.push({
          id: 'agent.core',
          kind: 'STABLE',
          trust: 'TRUSTED',
          priority: 85,
          cacheable: true,
          content: promptJson(agent.version.canonicalConfig),
          sourceVersionId: agent.version.id,
        });
      }
    }

    return blocks;
  }

  async persist(
    context: TenantContext,
    input: PersistInput<CanonicalCampaign, CampaignMutation>,
  ): Promise<PersistedTarget> {
    const change = {
      id: this.ids.generate(),
      entityType: 'CAMPAIGN' as const,
      source: 'MYAIHUB' as const,
      actorUserId: context.userId,
      hubOperationId: input.hubOperationId,
      hubMessageId: input.hubMessageId,
      interpretedIntent: input.interpretedIntent,
      mutations: input.mutations,
      rationale: input.rationale,
    };

    if (input.existing) {
      const saved = await this.campaigns.updateStrategy(context, {
        campaignId: input.existing.entityId,
        expectedLockVersion: input.existing.lockVersion,
        version: {
          id: this.ids.generate(),
          canonicalConfig: input.canonical,
          humanSummary: input.humanSummary,
          source: 'MYAIHUB',
          reason: input.interpretedIntent,
        },
        change: {
          ...change,
          fromVersionId: input.existing.versionId,
          fromVersion: input.existing.versionNumber,
        },
        audit: {
          accountId: context.accountId,
          actorUserId: context.userId,
          action: 'campaign.strategy_updated',
          entityType: 'Campaign',
          entityId: input.existing.entityId,
          metadata: {
            intent: input.interpretedIntent,
            items: countCampaignItems(input.canonical),
          },
        },
      });

      return {
        entityId: saved.campaign.id,
        versionNumber: saved.version?.versionNumber ?? 1,
        displayName: saved.campaign.name,
      };
    }

    if (!input.parentId) {
      // Chegar aqui significa operação mal declarada (`scopeIdRole` errado), não
      // erro do usuário: campanha órfã não é um estado que o domínio aceita.
      throw new AppError('VALIDATION_ERROR', 'Uma campanha precisa pertencer a um projeto.', {
        httpStatus: 422,
      });
    }

    const saved = await this.campaigns.create(context, {
      campaign: {
        id: this.ids.generate(),
        projectId: input.parentId,
        // Vínculo é ato explícito, feito depois: criar já vinculando ao "primeiro
        // agente disponível" seria o sistema escolhendo por quem fala com o
        // cliente do usuário.
        agentId: null,
        name: input.canonical.identity.name,
        slugBase: slugify(input.canonical.identity.name, 'campanha'),
        createdBy: context.userId ?? 'system',
      },
      version: {
        id: this.ids.generate(),
        canonicalConfig: input.canonical,
        humanSummary: input.humanSummary,
        source: 'MYAIHUB',
        reason: input.interpretedIntent,
      },
      change,
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: 'campaign.created',
        entityType: 'Campaign',
        metadata: { intent: input.interpretedIntent, projectId: input.parentId },
      },
    });

    return {
      entityId: saved.campaign.id,
      versionNumber: saved.version?.versionNumber ?? 1,
      displayName: saved.campaign.name,
    };
  }
}
