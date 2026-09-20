import type {
  CanonicalAgent,
  CanonicalBrandIdentity,
  CanonicalCampaign,
  CanonicalProjectProfile,
  KnowledgeReference,
} from '@myaihub/shared';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  publicTenantContext,
  runWithTenantContext,
  type TenantContext,
} from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import {
  PUBLIC_INLINE_IMAGE_LIMITS,
  validateInlineImages,
  type InlineImage,
} from '../../ai/domain/inline-images.js';
import { compileAgentPrompt, collectRuleChecks } from '../../agents/domain/agent-prompt.js';
import { parseSuggestedReplies } from '../../agents/domain/suggested-replies.js';
import type { ConversationService } from '../../conversations/application/conversation.service.js';
import {
  semanticHardRules,
  shouldValidate,
  type SemanticAdherenceValidator,
} from '../../conversations/application/adherence-validator.js';
import { runDeterministicChecks } from '../../myaihub/domain/rule-checks.js';
import type { KnowledgeRetriever } from '../../projects/domain/knowledge-retriever.js';
import type { KnowledgeRepository } from '../../projects/domain/knowledge-repositories.js';
import type { PublicDeploymentLookup } from '../domain/repositories.js';

export interface PublicChatDeps {
  lookup: PublicDeploymentLookup;
  gateway: LlmGateway;
  conversations: ConversationService;
  knowledge: KnowledgeRepository;
  retriever: KnowledgeRetriever;
  adherence: SemanticAdherenceValidator;
}

export interface PublicChatView {
  campaignName: string;
  agentName: string;
  /** O agente puxa o assunto: a UI dispara a abertura ao abrir a página. */
  agentOpens: boolean;
  /** A marca CONGELADA na publicação. É com ela que a página se desenha. */
  brand: CanonicalBrandIdentity | null;
}

export interface PublicChatReply {
  /** Devolvido sempre: é ele que o cliente manda de volta no turno seguinte. */
  sessionId: string;
  reply: string;
  violations: Array<{ check: string; message: string }>;
  /** Efêmeras, nunca persistidas — presente só quando o agente ofereceu. */
  suggestedReplies?: string[];
}

/** O turno mais longo que uma pessoa escreve num chat. Acima disso é abuso. */
const MAX_MESSAGE = 2000;

/** Quanto conhecimento cabe num turno sem espremer o resto do prompt. */
const MAX_KNOWLEDGE_REFERENCES = 3;
const MAX_KNOWLEDGE_CHARS = 1200;

/**
 * O Public Chat: a conversa que o público tem, servida pela PUBLICAÇÃO (§17 Fase 9).
 *
 * Quatro decisões estruturais, e nenhuma é detalhe:
 *
 * O `accountId` NUNCA vem do request. Ele é derivado no servidor —
 * publicId → deployment → campanha —, e só então o contexto de tenant é
 * montado. Aceitar tenant de fora numa rota sem autenticação seria entregar a
 * chave do multi-tenant a quem souber montar um POST.
 *
 * A conversa roda sobre o MANIFEST, não sobre a configuração atual. É a
 * invariante 7 tornada concreta: alterar o agente, a campanha, a MARCA ou o
 * CONHECIMENTO depois de publicar não muda o que está no ar.
 *
 * O histórico é DO SERVIDOR (Fase 8). Ele vinha do cliente, e isso significava
 * que o navegador de quem chegou pelo anúncio era a fonte de verdade sobre o
 * que o agente tinha respondido — além de a conversa morrer num F5, no meio de
 * um atendimento real.
 *
 * O que sobra é a sessão: ela nasce ligada ao `deploymentId` e morre com ele.
 * Republicar no meio de uma conversa não troca o agente embaixo de quem está
 * falando.
 */
export class PublicChatUseCase {
  constructor(private readonly deps: PublicChatDeps) {}

  /** O que a página precisa para se desenhar, antes de qualquer fala. */
  async view(publicId: string): Promise<PublicChatView> {
    const alvo = await this.load(publicId);

    return {
      campaignName: alvo.campaignName,
      agentName: alvo.agent.identity.name,
      agentOpens: alvo.agent.engagement.initiator === 'AGENT',
      brand: alvo.brand,
    };
  }

  /**
   * O transcrito de uma conversa em andamento — é o que faz o F5 não apagar
   * o atendimento.
   *
   * Persistir no servidor resolve METADE do problema: sem um caminho de volta,
   * o navegador recarrega e mostra tela vazia enquanto a conversa está inteira
   * no banco. O cliente guarda o `sessionId` e pede o resto aqui.
   *
   * A sessão é validada CONTRA O ENDEREÇO: id de outra campanha responde "não
   * existe", igual a um id inventado. Sem isso, quem tivesse um sessionId
   * qualquer leria a conversa de outra publicação.
   */
  async transcript(
    publicId: string,
    sessionId: string,
  ): Promise<{ turns: Array<{ role: 'VISITOR' | 'AGENT'; content: string }> }> {
    const alvo = await this.load(publicId);
    const context = publicTenantContext(alvo.accountId);

    return runWithTenantContext(context, async () => {
      const session = await this.deps.conversations.findSession(context, sessionId);

      if (!session || session.campaignId !== alvo.campaignId || session.channel !== 'PUBLIC') {
        throw new NotFoundError('NOT_FOUND', 'Esta conversa não existe mais.');
      }

      return { turns: await this.deps.conversations.transcript(context, sessionId) };
    });
  }

  /** A primeira fala, quando a configuração publicada diz que ele abre. */
  async open(
    publicId: string,
    input: { sessionId?: string | undefined },
  ): Promise<PublicChatReply> {
    const alvo = await this.load(publicId);

    if (alvo.agent.engagement.initiator !== 'AGENT') {
      throw new AppError('VALIDATION_ERROR', 'Este atendimento espera você começar.', {
        httpStatus: 422,
      });
    }

    const context = publicTenantContext(alvo.accountId);

    return runWithTenantContext(context, async () => {
      const session = await this.deps.conversations.resolveSession(context, {
        sessionId: input.sessionId ?? null,
        channel: 'PUBLIC',
        agentId: alvo.agentId,
        campaignId: alvo.campaignId,
        deploymentId: alvo.deploymentId,
        projectId: alvo.projectId,
        scenario: null,
      });

      // O atalho de custo zero vale aqui também: roteiro literal já está escrito.
      // Mas ele PERSISTE do mesmo jeito — uma abertura que não vira mensagem
      // some no recarregamento, e o agente se reapresentaria.
      if (alvo.agent.engagement.openerMode === 'SCRIPTED' && alvo.agent.engagement.opener) {
        await this.deps.conversations.recordTurn(context, {
          session,
          visitorMessage: null,
          turn: {
            reply: alvo.agent.engagement.opener,
            violations: [],
            ctaUrl: alvo.campaign.cta?.url ?? null,
            hadVisitorMessage: false,
          },
          usage: { totalTokens: 0, costMicros: 0 },
          aiCallId: null,
          statePatch: null,
        });

        return { sessionId: session.id, reply: alvo.agent.engagement.opener, violations: [] };
      }

      return this.talk(
        context,
        alvo,
        session,
        null,
        '(a pessoa acabou de abrir a conversa e ainda não disse nada)',
      );
    });
  }

  async reply(
    publicId: string,
    input: {
      message: string;
      sessionId?: string | undefined;
      /** Efêmera: vira `LlmImagePart` deste turno e nunca é persistida. */
      images?: InlineImage[] | undefined;
    },
  ): Promise<PublicChatReply> {
    if (input.message.length > MAX_MESSAGE) {
      throw new AppError('VALIDATION_ERROR', 'Mensagem longa demais.', { httpStatus: 422 });
    }

    const images = input.images ?? [];
    validateInlineImages(images, PUBLIC_INLINE_IMAGE_LIMITS);

    // Foto sem legenda é o caso mais comum de anexo — o texto persistido não
    // pode ficar vazio, e o modelo precisa de ALGO no turno além da imagem.
    const message = input.message.trim().length > 0 ? input.message : '(imagem anexada)';

    const alvo = await this.load(publicId);
    const context = publicTenantContext(alvo.accountId);

    return runWithTenantContext(context, async () => {
      const session = await this.deps.conversations.resolveSession(context, {
        sessionId: input.sessionId ?? null,
        channel: 'PUBLIC',
        agentId: alvo.agentId,
        campaignId: alvo.campaignId,
        deploymentId: alvo.deploymentId,
        projectId: alvo.projectId,
        scenario: null,
      });

      return this.talk(context, alvo, session, message, message, images);
    });
  }

  /**
   * Resolve o endereço público até a configuração CONGELADA.
   *
   * Deployment inexistente e deployment de campanha despublicada respondem a
   * mesma coisa: não existe. Distinguir os dois contaria a quem sonda o que
   * existe do outro lado.
   */
  private async load(publicId: string) {
    const alvo = await this.deps.lookup.findActiveByPublicId(publicId);
    if (!alvo) throw new NotFoundError('NOT_FOUND', 'Este atendimento não está disponível.');
    return alvo;
  }

  private async talk(
    context: TenantContext,
    alvo: Awaited<ReturnType<PublicChatUseCase['load']>>,
    session: { id: string },
    visitorMessage: string | null,
    prompt: string,
    images: InlineImage[] = [],
  ): Promise<PublicChatReply> {
    const history = await this.deps.conversations.history(context, session.id);

    // A recuperação usa a última fala como consulta: é ela que diz o que a
    // pessoa quer saber AGORA. Usar a conversa inteira faria toda pergunta
    // recuperar os mesmos trechos do começo do atendimento.
    const knowledge = await this.retrieveKnowledge(context, alvo.knowledgeSnapshotId, prompt);

    const systemPrompt = compileAgentPrompt({
      agent: alvo.agent,
      campaign: alvo.campaign,
      ...(alvo.project ? { project: alvo.project } : {}),
      ...(alvo.brand ? { brand: alvo.brand } : {}),
      ...(knowledge.length > 0 ? { knowledge } : {}),
    });

    const result = await this.deps.gateway.generate(context, {
      role: 'agent.runtime',
      // O prompt vem PRONTO: quem compila o Agent Core é o domínio de
      // agentes, e é esse mesmo texto que a publicação congelou.
      blocks: [
        {
          id: 'agent.published',
          kind: 'STABLE',
          trust: 'TRUSTED',
          priority: 100,
          essential: true,
          cacheable: true,
          content: systemPrompt,
        },
      ],
      messages: [
        ...history,
        { role: 'user' as const, content: prompt, ...(images.length ? { images } : {}) },
      ],
      params: { temperature: 0.6 },
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
    // chamada ao provider. A partir daqui, `reply` é a fala LIMPA — regras,
    // persistência e a detecção de CTA por substring têm que ver o texto que
    // o visitante vê, nunca o marcador cru.
    const { reply, suggestedReplies } = parseSuggestedReplies(result.content);

    const deterministicas = runDeterministicChecks(
      reply,
      collectRuleChecks(alvo.agent, alvo.campaign, alvo.project ?? undefined),
    ).map((violation) => ({ check: violation.check, message: violation.message }));

    // Amostrado em produção (§6.2): o custo de validar todo turno de um
    // atendimento longo não se paga, e a taxa de violação não muda tanto entre
    // turnos a ponto de justificar isso.
    const semantic = shouldValidate('sampled', Math.random())
      ? await this.deps.adherence.validate(context, {
          rules: semanticHardRules(alvo.agent, alvo.campaign),
          objective: alvo.campaign.goal.primary,
          transcript: history,
          reply,
        })
      : null;

    const violations = [...deterministicas, ...(semantic?.violations ?? [])];

    await this.deps.conversations.recordTurn(context, {
      session,
      visitorMessage,
      turn: {
        reply,
        violations,
        ctaUrl: alvo.campaign.cta?.url ?? null,
        hadVisitorMessage: visitorMessage !== null,
      },
      usage: { totalTokens: result.totalTokens, costMicros: result.costMicros },
      aiCallId: result.aiCallId,
      statePatch: semantic?.statePatch ?? null,
    });

    return {
      sessionId: session.id,
      reply,
      violations,
      ...(suggestedReplies.length ? { suggestedReplies } : {}),
    };
  }

  private async retrieveKnowledge(
    context: TenantContext,
    snapshotId: string | null,
    query: string,
  ): Promise<KnowledgeReference[]> {
    if (!snapshotId) return [];

    const entries = await this.deps.knowledge.readSnapshot(context, snapshotId);
    if (entries.length === 0) return [];

    return this.deps.retriever.retrieve({
      entries,
      query,
      maxReferences: MAX_KNOWLEDGE_REFERENCES,
      maxCharsPerReference: MAX_KNOWLEDGE_CHARS,
    });
  }
}

export interface PublicDeploymentTarget {
  accountId: string;
  campaignId: string;
  deploymentId: string;
  projectId: string;
  agentId: string;
  campaignName: string;
  agent: CanonicalAgent;
  campaign: CanonicalCampaign;
  project: CanonicalProjectProfile | null;
  brand: CanonicalBrandIdentity | null;
  knowledgeSnapshotId: string | null;
}
