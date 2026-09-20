import type {
  CanonicalAgent,
  CanonicalBrandIdentity,
  CanonicalCampaign,
  CanonicalProjectProfile,
  KnowledgeReference,
} from '@myaihub/shared';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import {
  LAB_INLINE_IMAGE_LIMITS,
  validateInlineImages,
  type InlineImage,
} from '../../ai/domain/inline-images.js';
import type { CampaignRepository } from '../../campaigns/domain/repositories.js';
import {
  semanticHardRules,
  shouldValidate,
  type SemanticAdherenceValidator,
} from '../../conversations/application/adherence-validator.js';
import type { ConversationService } from '../../conversations/application/conversation.service.js';
import { runDeterministicChecks, type RuleViolation } from '../../myaihub/domain/rule-checks.js';
import type { BrandIdentityRepository } from '../../projects/domain/brand-repositories.js';
import type { KnowledgeRepository } from '../../projects/domain/knowledge-repositories.js';
import type { KnowledgeRetriever } from '../../projects/domain/knowledge-retriever.js';
import type { ProjectRepository } from '../../projects/domain/repositories.js';
import { collectRuleChecks, compileAgentPrompt } from '../domain/agent-prompt.js';
import type { AgentRepository } from '../domain/repositories.js';
import { parseSuggestedReplies } from '../domain/suggested-replies.js';
import type { PendingAdherence } from '../../conversations/application/pending-adherence.js';
import type { Logger } from '../../../shared/application/ports.js';

export interface TestAgentInput {
  agentId: string;
  /** Quando presente, o teste roda com o contexto da campanha (§ Lab). */
  campaignId?: string | undefined;
  /**
   * Quando presente (e sem campanha), o teste roda com o PROJETO inteiro.
   *
   * É o meio-termo que faltava. Direto no agente não há negócio nenhum e o
   * usuário precisa inventar um cenário; pela campanha o recorte é estreito de
   * propósito. Aqui ele testa o que o agente sabe do NEGÓCIO — que é onde mora
   * quase tudo o que ele acabou de cadastrar.
   */
  projectId?: string | undefined;
  /** Cenário escrito pelo usuário. Só no laboratório sem campanha. */
  scenario?: string | undefined;
  /**
   * A conversa persistida (Fase 8). Ausente = começa uma nova.
   *
   * O histórico deixou de vir do cliente. No Lab isso pesa menos que no chat
   * público, mas pesa: recarregar no meio de um teste longo apagava justamente
   * a conversa que o usuário ia mostrar ao OS para pedir o ajuste.
   */
  sessionId?: string | undefined;
  message: string;
  /**
   * Efêmera (§ imagens do agente): vira `LlmImagePart` deste turno e nunca é
   * persistida — o histórico guarda só o texto (ou o placeholder, se a
   * mensagem era só a imagem).
   */
  images?: InlineImage[] | undefined;
}

export interface TestAgentResult {
  /** Devolvido sempre: é ele que o cliente manda de volta no turno seguinte. */
  sessionId: string;
  reply: string;
  /** Regras que a resposta violou — determinísticas e semânticas. */
  violations: RuleViolation[];
  /**
   * A checagem semântica rodou neste turno?
   *
   * Sem isto, `violations: []` significava duas coisas incompatíveis — "conferi
   * e passou" e "não consegui conferir" — e a tela mostrava o selo verde nas
   * duas. `NOT_APPLICABLE` é o terceiro caso legítimo: nenhuma regra HARD sem
   * checker, então não havia o que a validação semântica fizesse.
   */
  adherence: 'CHECKING' | 'CHECKED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
  /**
   * O turno gravado, para a tela buscar o veredito que vem depois.
   *
   * Ele volta com `CHECKING`: a fala já está na tela e a conferência ainda
   * corre. Sem este id a tela não teria como perguntar pelo resultado.
   */
  turnId: string;
  /** O prompt que o agente recebeu — o Lab existe para mostrar isto. */
  systemPrompt: string;
  /** Trechos do conhecimento que entraram no contexto deste turno. */
  knowledge: KnowledgeReference[];
  costMicros: number;
  totalTokens: number;
  /**
   * Efêmeras: extraídas do texto da fala, nunca persistidas (mesmo
   * tratamento do preview de imagem). Presente só quando o agente decidiu
   * oferecer — a maioria dos turnos não tem nenhuma.
   */
  suggestedReplies?: string[];
}

/**
 * Conversa de teste com o agente (Internal Lab, §17 Fase 8).
 *
 * PERSISTE, mas em canal próprio. O Lab era efêmero por falta da Fase 8, e a
 * ausência custava duas coisas: a conversa morria num recarregamento, e o OS —
 * que lê o transcrito para diagnosticar — dependia do que o navegador ainda
 * tivesse na memória.
 *
 * O que NÃO mudou é o que importava naquela decisão: `channel: 'LAB'` fica fora
 * de toda métrica. Experimento que suja o relatório de conversas reais faz o
 * relatório deixar de servir.
 *
 * O que o Lab entrega além da resposta: o PROMPT COMPILADO, as violações e
 * agora os TRECHOS de conhecimento que entraram. Sem o terceiro, "ele respondeu
 * com base na nossa base" seria uma afirmação que ninguém consegue conferir.
 */
interface LoadedAgent {
  agent: CanonicalAgent;
  campaign: CanonicalCampaign | undefined;
  project: CanonicalProjectProfile | undefined;
  brand: CanonicalBrandIdentity | undefined;
  projectId: string | undefined;
  campaignId: string | undefined;
  scenario: string | undefined;
}

/** De onde o teste tira o contexto: campanha, projeto, ou cenário escrito. */
interface TestContextInput {
  campaignId?: string | undefined;
  projectId?: string | undefined;
  scenario?: string | undefined;
  sessionId?: string | undefined;
}

const MAX_KNOWLEDGE_REFERENCES = 3;
const MAX_KNOWLEDGE_CHARS = 1200;

export class TestAgentUseCase {
  constructor(
    private readonly deps: {
      agents: AgentRepository;
      campaigns: CampaignRepository;
      projects: ProjectRepository;
      brands: BrandIdentityRepository;
      knowledge: KnowledgeRepository;
      retriever: KnowledgeRetriever;
      conversations: ConversationService;
      adherence: SemanticAdherenceValidator;
      gateway: LlmGateway;
      /** Onde o veredito da conferência espera até a tela buscá-lo. */
      pending: PendingAdherence;
      logger: Logger;
    },
  ) {}

  /**
   * O agente puxa o assunto.
   *
   * Com sessão já existente, isto é uma RETOMADA, não uma abertura: a mesma
   * pessoa continua a mesma conversa. Reiniciar mantendo o contexto e receber
   * "olá, eu sou o Alex, como posso te chamar?" de quem acabou de dizer o nome
   * faz o agente parecer outra pessoa — e contradiz o transcrito na tela.
   */
  async open(
    context: TenantContext,
    agentId: string,
    options: TestContextInput = {},
  ): Promise<TestAgentResult> {
    const loaded = await this.load(context, agentId, options);
    const session = await this.session(context, agentId, loaded, options.sessionId ?? null);
    const history = await this.deps.conversations.history(context, session.id);
    const retomada = history.length > 0;

    // O atalho de custo zero vale só para a PRIMEIRA fala com roteiro literal.
    // Em abertura ADAPTATIVA ele devolvia o campo verbatim, e o Lab imprimia a
    // DIRETRIZ como se fosse a fala do agente. Instrução não é diálogo.
    if (
      !retomada &&
      loaded.agent.engagement.openerMode === 'SCRIPTED' &&
      loaded.agent.engagement.opener
    ) {
      const opener = loaded.agent.engagement.opener;

      const gravado = await this.deps.conversations.recordTurn(context, {
        session,
        visitorMessage: null,
        turn: {
          reply: opener,
          violations: [],
          ctaUrl: loaded.campaign?.cta?.url ?? null,
          hadVisitorMessage: false,
        },
        usage: { totalTokens: 0, costMicros: 0 },
        aiCallId: null,
        statePatch: null,
      });

      return {
        sessionId: session.id,
        reply: opener,
        violations: [],
        turnId: gravado.agentMessageId,
        // Roteiro literal escrito pelo usuário, devolvido sem passar por modelo:
        // não há resposta gerada para auditar.
        adherence: 'NOT_APPLICABLE',
        systemPrompt: this.compile(loaded, []),
        knowledge: [],
        costMicros: 0,
        totalTokens: 0,
      };
    }

    return this.talk(context, loaded, session, history, {
      // O modelo precisa de um turno para responder. Este marcador não é fala
      // do usuário: descreve a situação, e o prompt já mandou abrir.
      visitorMessage: null,
      prompt: retomada
        ? '(a conversa acima foi retomada agora, com a MESMA pessoa. Continue de onde parou: não se apresente de novo e não pergunte nada que ela já respondeu. Puxe o próximo assunto.)'
        : '(a pessoa acabou de abrir a conversa e ainda não disse nada)',
    });
  }

  async execute(context: TenantContext, input: TestAgentInput): Promise<TestAgentResult> {
    const images = input.images ?? [];
    validateInlineImages(images, LAB_INLINE_IMAGE_LIMITS);

    // Foto sem legenda ("segue a peça") é o caso mais comum de anexo — o
    // texto persistido não pode ficar vazio, e o modelo precisa de ALGO no
    // turno além da imagem.
    const message = input.message.trim().length > 0 ? input.message : '(imagem anexada)';

    const loaded = await this.load(context, input.agentId, input);
    const session = await this.session(context, input.agentId, loaded, input.sessionId ?? null);
    const history = await this.deps.conversations.history(context, session.id);

    return this.talk(context, loaded, session, history, {
      visitorMessage: message,
      prompt: message,
      ...(images.length ? { images } : {}),
    });
  }

  /** Agente, campanha, projeto e marca — o que os dois caminhos precisam. */
  private async load(
    context: TenantContext,
    agentId: string,
    input: TestContextInput,
  ): Promise<LoadedAgent> {
    const found = await this.deps.agents.findById(context, agentId);
    if (!found) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

    const agent = found.version?.canonicalConfig;
    if (!agent) {
      throw new NotFoundError('AGENT_NOT_FOUND', 'Este agente ainda não tem configuração salva.');
    }

    let campaign: CanonicalCampaign | undefined;
    // A campanha MANDA no projeto: ela sabe a qual pertence, e um projectId
    // divergente vindo do cliente descreveria um teste que não existe.
    let projectId = input.projectId;

    if (input.campaignId) {
      const encontrada = await this.deps.campaigns.findById(context, input.campaignId);
      if (!encontrada) throw new NotFoundError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
      campaign = encontrada.version?.canonicalConfig;
      projectId = encontrada.campaign.projectId;
    }

    // O PERFIL INTEIRO, não o `summary`: o agente representava um negócio do
    // qual conhecia uma frase.
    //
    // E aqui, ao contrário do chat público, lê-se a versão CORRENTE — não a
    // congelada. É um laboratório: testar o que já está publicado seria
    // responder à pergunta errada, que é justamente "o ajuste que acabei de
    // fazer funcionou?".
    const project = projectId
      ? ((await this.deps.projects.findById(context, projectId))?.profile?.canonicalConfig ??
        undefined)
      : undefined;

    const brand = projectId
      ? ((await this.deps.brands.findCurrent(context, projectId))?.canonicalConfig ?? undefined)
      : undefined;

    return {
      agent,
      campaign,
      project,
      brand,
      projectId,
      campaignId: input.campaignId,
      scenario: input.scenario,
    };
  }

  private async session(
    context: TenantContext,
    agentId: string,
    loaded: LoadedAgent,
    sessionId: string | null,
  ) {
    return this.deps.conversations.resolveSession(context, {
      sessionId,
      channel: 'LAB',
      agentId,
      campaignId: loaded.campaignId ?? null,
      // Sem deployment: o Lab roda contra um manifest EFÊMERO, com as versões
      // em rascunho (§4.3). Fingir um deploymentId aqui faria uma conversa de
      // teste parecer servida por uma publicação que não existe.
      deploymentId: null,
      projectId: loaded.projectId ?? null,
      scenario: loaded.scenario ?? null,
    });
  }

  private compile(loaded: LoadedAgent, knowledge: KnowledgeReference[]): string {
    return compileAgentPrompt({
      agent: loaded.agent,
      ...(loaded.campaign ? { campaign: loaded.campaign } : {}),
      ...(loaded.project ? { project: loaded.project } : {}),
      ...(loaded.brand ? { brand: loaded.brand } : {}),
      ...(loaded.scenario ? { testScenario: loaded.scenario } : {}),
      ...(knowledge.length > 0 ? { knowledge } : {}),
    });
  }

  private async talk(
    context: TenantContext,
    loaded: LoadedAgent,
    session: { id: string },
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    turn: { visitorMessage: string | null; prompt: string; images?: InlineImage[] },
  ): Promise<TestAgentResult> {
    const knowledge = await this.retrieveKnowledge(context, loaded.projectId, turn.prompt);
    const systemPrompt = this.compile(loaded, knowledge);

    const generated = await this.deps.gateway.generate(context, {
      role: 'agent.runtime',
      // O prompt vem PRONTO daqui, não de blocos: quem compila o Agent Core é o
      // domínio de agentes, e é esse mesmo texto que a publicação vai congelar.
      blocks: [
        {
          id: 'agent.runtime.prompt',
          kind: 'STABLE',
          trust: 'TRUSTED',
          priority: 100,
          cacheable: true,
          content: systemPrompt,
        },
      ],
      messages: [
        ...history,
        {
          role: 'user' as const,
          content: turn.prompt,
          ...(turn.images?.length ? { images: turn.images } : {}),
        },
      ],
      // Sem `thinkingBudget`: declarar o campo LIGA um passe de raciocínio que
      // sem ele não acontece. Ver a nota em `provider.ts`.
      params: { temperature: 0.6 },
      tokenBudget: 12_000,
      sessionId: session.id,
      // O que ENTROU, para o trace. Ids e pontuação, nunca o texto: o conteúdo
      // é do cliente e o trace é lido por operadores (§8.1).
      knowledgeRefs: knowledge.map((referencia) => ({
        sourceId: referencia.sourceId,
        revisionId: referencia.revisionId,
        score: referencia.score,
      })),
    });

    // Respostas recomendadas são um sinal DENTRO da fala, nunca uma segunda
    // chamada ao provider (§ latência do agent.runtime). A partir daqui,
    // `reply` é a fala LIMPA — tudo o que segue (regras, persistência,
    // detecção de CTA por substring) tem que ver o texto que o visitante vê,
    // nunca o marcador cru.
    const { reply, suggestedReplies } = parseSuggestedReplies(generated.content);

    // As regras determinísticas rodam SOBRE a resposta — é o que transforma
    // "verificada em código" numa afirmação verdadeira (§6.1).
    const deterministicas = runDeterministicChecks(
      reply,
      collectRuleChecks(loaded.agent, loaded.campaign, loaded.project),
    );

    /*
      O TURNO VOLTA AGORA. A conferência vem atrás.

      A validação semântica é uma SEGUNDA chamada ao provider, e ela rodava
      serializada na frente do usuário: a fala do agente já existia, já estava
      paga, e ficava retida até um auditor conferir as regras. Medido no banco,
      emparelhando cada turno com a auditoria seguinte — mediana de ~1s no
      agente e ~1,1s no auditor: ele DOBRAVA a espera na tela. Travando, cobrava
      8s a mais para no fim dizer "checagem indisponível".

      A arquitetura já dizia metade disto: "falha do validador NÃO derruba o
      turno". Esperar por ele é o mesmo erro, só que silencioso — o usuário não
      vê um erro, vê o produto lento.

      No Lab a conferência continua rodando SEMPRE (§6.2): é ali que o usuário
      pergunta se a configuração pega, e amostrar responderia "talvez". O que
      mudou é só QUANDO ele lê o resultado.
    */
    const gravado = await this.deps.conversations.recordTurn(context, {
      session,
      visitorMessage: turn.visitorMessage,
      turn: {
        reply,
        violations: deterministicas.map((violation) => ({
          check: violation.check,
          message: violation.message,
        })),
        ctaUrl: loaded.campaign?.cta?.url ?? null,
        hadVisitorMessage: turn.visitorMessage !== null,
      },
      usage: { totalTokens: generated.totalTokens, costMicros: generated.costMicros },
      aiCallId: generated.aiCallId,
      statePatch: null,
    });

    const rules = semanticHardRules(loaded.agent, loaded.campaign);
    const vaiConferir = rules.length > 0 && shouldValidate('on', Math.random());

    if (vaiConferir) {
      this.deps.pending.start(gravado.agentMessageId);
      // Sem `await`: é isto que devolve a fala ao usuário na hora. A falha aqui
      // nunca sobe — ela vira o veredito "indisponível", que é a verdade.
      void this.audit(context, {
        turnId: gravado.agentMessageId,
        sessionId: session.id,
        rules,
        objective: loaded.campaign?.goal.primary ?? '',
        transcript: history,
        reply,
        deterministicas,
      });
    }

    return {
      sessionId: session.id,
      reply,
      violations: deterministicas,
      /** O identificador pelo qual a tela vai buscar o veredito. */
      turnId: gravado.agentMessageId,
      // Sem regra semântica não há o que conferir, e dizer "conferindo" faria a
      // tela esperar por um veredito que nunca vem.
      adherence: vaiConferir ? 'CHECKING' : 'NOT_APPLICABLE',
      systemPrompt,
      knowledge,
      costMicros: generated.costMicros,
      totalTokens: generated.totalTokens,
      ...(suggestedReplies.length ? { suggestedReplies } : {}),
    };
  }

  /**
   * A conferência, fora do caminho da resposta.
   *
   * As violações são GRAVADAS quando saem — elas são o dado, e o transcrito
   * restaurado depois de um F5 precisa delas. O estado da conferência fica em
   * memória: é interface, e morre com a tela.
   */
  private async audit(
    context: TenantContext,
    input: {
      turnId: string;
      sessionId: string;
      rules: ReturnType<typeof semanticHardRules>;
      objective: string;
      transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
      reply: string;
      deterministicas: RuleViolation[];
    },
  ): Promise<void> {
    try {
      const semantic = await this.deps.adherence.validate(context, {
        rules: input.rules,
        objective: input.objective,
        transcript: input.transcript,
        reply: input.reply,
      });

      const semanticas: RuleViolation[] = (semantic?.violations ?? []).map((violation) => ({
        check: violation.check,
        message: violation.message,
      }));

      const todas = [...input.deterministicas, ...semanticas];

      this.deps.pending.set(input.turnId, {
        status: semantic?.status ?? 'NOT_APPLICABLE',
        violations: todas,
      });

      // Só volta ao banco se houver o que acrescentar: uma escrita que grava o
      // mesmo array de antes é ida ao banco por nada, em todo turno limpo.
      if (semanticas.length > 0 || semantic?.statePatch) {
        await this.deps.conversations.attachAdherence(context, {
          sessionId: input.sessionId,
          messageId: input.turnId,
          violations: todas.map((violation) => ({
            check: violation.check,
            message: violation.message,
          })),
          newViolations: semanticas.map((violation) => ({
            check: violation.check,
            message: violation.message,
          })),
          statePatch: semantic?.statePatch ?? null,
        });
      }
    } catch (error) {
      // O turno do usuário já foi entregue. O que se perde aqui é a conferência,
      // e é isso que a tela vai dizer — nunca um selo verde por omissão.
      this.deps.logger.error({ err: error, turnId: input.turnId }, 'conferência do Lab falhou');
      this.deps.pending.set(input.turnId, {
        status: 'UNAVAILABLE',
        violations: input.deterministicas,
      });
    }
  }

  /**
   * Conhecimento do projeto, na revisão CORRENTE.
   *
   * O chat público lê do snapshot congelado; aqui não há snapshot porque não há
   * publicação. É a mesma diferença do perfil: o Lab responde "o que eu
   * cadastrei funciona?", e para isso precisa do que foi cadastrado agora.
   */
  private async retrieveKnowledge(
    context: TenantContext,
    projectId: string | undefined,
    query: string,
  ): Promise<KnowledgeReference[]> {
    if (!projectId) return [];

    const sources = await this.deps.knowledge.listSources(context, projectId);
    const prontas = sources.filter(
      (source) => source.status === 'READY' && source.currentRevisionId,
    );
    if (prontas.length === 0) return [];

    const entries = await Promise.all(
      prontas.map(async (source) => {
        const revision = await this.deps.knowledge.readRevision(
          context,
          source.currentRevisionId as string,
        );
        return revision
          ? {
              sourceId: source.id,
              revisionId: revision.id,
              title: source.title,
              uri: source.uri,
              extractedContent: revision.extractedContent,
            }
          : null;
      }),
    );

    return this.deps.retriever.retrieve({
      entries: entries.filter((entry) => entry !== null),
      query,
      maxReferences: MAX_KNOWLEDGE_REFERENCES,
      maxCharsPerReference: MAX_KNOWLEDGE_CHARS,
    });
  }
}
