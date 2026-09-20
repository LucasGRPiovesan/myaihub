import type { ModelRole } from '@myaihub/shared';
import type { ZodType } from 'zod';
import { AppError, isAppError } from '../../../shared/domain/errors.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type {
  AiCallStatus,
  RecordAiCallUseCase,
} from '../../usage/application/record-ai-call.use-case.js';
import type { ContextBlock } from '../domain/context.js';
import {
  StructuredOutputError,
  type GenerationParams,
  type LlmChunk,
  type LlmMessage,
  type LlmResult,
} from '../domain/provider.js';
import { ContextCompiler, CONTEXT_COMPILER_VERSION } from './context-compiler.js';
import type { ModelRouter } from './model-router.js';
import { PromptCompiler, PROMPT_COMPILER_VERSION } from './prompt-compiler.js';
import type { ServedTierObserver } from './served-tier.js';

export const RUNTIME_VERSION = '1.0.0';

/** Tokens de contexto por padrão. Cada operação pode apertar isso (§16.3). */
const DEFAULT_TOKEN_BUDGET = 24_000;

/**
 * Quanto tempo cada PAPEL merece.
 *
 * O papel já significa "quão pesado é este trabalho"; é a mesma informação que
 * diz quanto vale a pena esperar. Antes o teto vinha do tipo de chamada
 * (estruturada ou conversa), e uma saída curta herdava o teto da pesada: o
 * briefing, que produz três perguntas, esperava 25s por tentativa e falhava
 * depois de 78 segundos — três travadas seguidas do provider, medidas.
 *
 * Papel ausente aqui usa o padrão do provider, que é o certo para o trabalho
 * pesado. Só quem é RÁPIDO por definição precisa dizer que é.
 */
const ROLE_TIMING: Partial<Record<ModelRole, { stallMs: number; totalMs: number }>> = {
  /**
   * Saída curta, mas o vigia tem que caber a cauda SAUDÁVEL do provider.
   *
   * Era 6s, e matava pedido que ia responder: a distribuição medida da primeira
   * palavra encosta em 4,4s antes do grupo morto (14s+), então 6s deixa apenas
   * 1,6s de margem. Medido no banco, `hub.fast` falhou em 12,9s — 6s de vigia
   * mais a repetição inteira — em turnos que o provider teria servido.
   *
   * 8s é o mesmo raciocínio do turno de conversa, e o teto continua dando
   * espaço para UMA repetição sequencial: falhar aqui custa ao usuário o fluxo
   * de criação inteiro.
   */
  'hub.fast': { stallMs: 8_000, totalMs: 30_000 },
  /**
   * O AUDITOR não repete. E o teto diz isso sem precisar de um campo novo.
   *
   * Ele roda DEPOIS da resposta do agente, na frente do usuário, para conferir
   * regra. Quando trava, a escolha não é entre auditar rápido e auditar devagar:
   * é entre entregar a resposta em 1s dizendo "não consegui conferir" ou segurar
   * o turno inteiro por meio minuto tentando de novo — medido: 16s, 17s, 21s e
   * 34s de espera por uma auditoria que roda em 800ms.
   *
   * Com 8s de vigia e 11s de teto, a repetição não CABE (`MIN_TIME_TO_RETRY_MS`
   * exige 5s de folga), então ela não acontece — e o Lab mostra "checagem
   * indisponível", que é verdade e custa zero.
   *
   * O vigia era 6s, e o preço apareceu no banco: 6 de 7 auditorias falharam em
   * ~6,1s, todas com `in0/out0` — nenhum token produzido. Não era o provider
   * recusando; era o número. Um auditor que quase nunca conclui não audita
   * nada, e o pior é que ele fazia isso GASTANDO um pedido por turno para
   * devolver "checagem indisponível". 8s acompanha a cauda saudável medida
   * (4,4s) e mantém a promessa que importa: não segurar o turno do usuário.
   */
  'validation.fast': { stallMs: 8_000, totalMs: 11_000 },
};

export interface LlmGatewayRequest {
  role: ModelRole;
  blocks: ContextBlock[];
  messages: LlmMessage[];
  params?: GenerationParams;
  tokenBudget?: number;
  policyVersionId?: string;
  policySections?: string[];
  sessionId?: string;
  hubOperationId?: string;
  /**
   * Trechos de conhecimento que entraram neste turno.
   *
   * Chegam prontos de quem recuperou: o gateway não sabe (nem deve saber) o
   * que é uma fonte de conhecimento — ele só garante que isso vá para o trace,
   * junto do resto do que explica a resposta.
   */
  knowledgeRefs?: Array<{ sourceId: string; revisionId: string; score: number }>;
}

/**
 * Ponto único de saída para qualquer LLM.
 *
 * Nenhum use case fala com provider diretamente. Passar por aqui garante que
 * TODA chamada compile contexto do mesmo jeito, respeite a segregação de
 * conteúdo untrusted, e registre uso, custo e trace — inclusive quando falha.
 * Um caminho alternativo seria um caminho sem custo rastreado.
 */
/**
 * O que uma chamada custou, devolvido junto do resultado.
 *
 * Sobe até o painel porque o usuário precisa ver a conta enquanto ela é feita —
 * descobrir o gasto só na fatura é o oposto de "administrar a implementação".
 */
export interface AiCallOutcome {
  aiCallId: string;
  costMicros: number;
  totalTokens: number;
}

/**
 * Mensagem corretiva para uma saída que não bateu com o schema.
 *
 * `null` quando o erro não é de forma — não faz sentido repetir uma falha de
 * rede ou de permissão com "corrija os campos".
 */
export function schemaCorrection(error: unknown): string | null {
  if (!isAppError(error) || error.code !== 'STRUCTURED_OUTPUT_INVALID') return null;

  const issues = error.details;
  if (!Array.isArray(issues) || issues.length === 0) {
    return 'A resposta anterior não era JSON válido. Responda SOMENTE com o JSON pedido.';
  }

  const lines = (issues as Array<{ path?: string; message?: string }>)
    .slice(0, 8)
    .map((issue) => `  - ${issue.path || '(raiz)'}: ${issue.message ?? 'inválido'}`);

  return [
    'Sua resposta anterior não bateu com o formato exigido. Problemas encontrados:',
    ...lines,
    '',
    'Responda de novo com o MESMO conteúdo, corrigindo apenas estes campos.',
    'Não recomece o raciocínio nem mude suas decisões: só devolva a estrutura certa.',
  ].join('\n');
}

export class LlmGateway {
  private readonly contextCompiler = new ContextCompiler();
  private readonly promptCompiler = new PromptCompiler();

  constructor(
    private readonly router: ModelRouter,
    private readonly recordAiCall: RecordAiCallUseCase,
    /**
     * Onde fica registrado QUAL COTA serviu.
     *
     * O gateway é quem vê o `tier` de toda chamada, então é daqui que o fato
     * sai — em vez de o resto do sistema perguntar ao adapter, que só sabe o
     * que ele TENTARIA agora e esquece isso a cada restart.
     */
    private readonly servedTier?: ServedTierObserver,
  ) {}

  private prepare(request: LlmGatewayRequest) {
    const { provider, model } = this.router.resolve(request.role);

    const context = this.contextCompiler.compile({
      blocks: request.blocks,
      tokenBudget: request.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    });

    const timing = ROLE_TIMING[request.role];

    const llmRequest = this.promptCompiler.compile({
      context,
      messages: request.messages,
      model,
      params: request.params ?? {},
      ...(timing ? { timing } : {}),
    });

    return { provider, model, context, llmRequest };
  }

  /**
   * Snapshot dos blocos para o trace.
   *
   * Guarda hash e metadados, não o conteúdo: o contexto pode conter dado
   * pessoal do usuário final, e o trace é lido por operadores.
   */
  private traceBlocks(context: ReturnType<ContextCompiler['compile']>) {
    return {
      kept: context.blocks.map((block) => ({
        id: block.id,
        kind: block.kind,
        trust: block.trust,
        cacheable: block.cacheable,
        tokensEstimate: block.tokensEstimate,
        contentHash: block.contentHash,
        sourceVersionId: block.sourceVersionId ?? null,
      })),
      dropped: context.dropped,
      tokenBudget: context.tokenBudget,
      tokensEstimate: context.tokensEstimate,
    };
  }

  private statusFor(error: unknown): { status: AiCallStatus; errorCode: string } {
    if (isAppError(error)) {
      if (error.code === 'PROVIDER_TIMEOUT') return { status: 'TIMEOUT', errorCode: error.code };
      if (error.code === 'STRUCTURED_OUTPUT_INVALID') {
        return { status: 'INVALID_OUTPUT', errorCode: error.code };
      }
      return { status: 'PROVIDER_ERROR', errorCode: error.code };
    }
    return { status: 'PROVIDER_ERROR', errorCode: 'INTERNAL_ERROR' };
  }

  private async persist(
    tenant: TenantContext,
    request: LlmGatewayRequest,
    prepared: ReturnType<LlmGateway['prepare']>,
    outcome:
      { ok: true; result: LlmResult<unknown> } | { ok: false; error: unknown; latencyMs: number },
  ): Promise<AiCallOutcome> {
    // Saída recusada por schema CUSTOU: o provider gerou, cobrou e respondeu —
    // quem recusou fomos nós. Zerar ali fazia a chamada mais cara do sistema
    // entrar no banco como se fosse de graça, e a conta que o painel mostra
    // deixava de fora justamente o turno que o usuário mais sentiu.
    const usage =
      outcome.ok === true
        ? outcome.result.usage
        : outcome.error instanceof StructuredOutputError
          ? { ...outcome.error.usage, latencyMs: outcome.latencyMs }
          : {
              inputTokens: 0,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              toolCalls: 0,
              totalTokens: 0,
              latencyMs: outcome.latencyMs,
            };

    const failure = outcome.ok
      ? null
      : {
          ...this.statusFor(outcome.error),
          // O código sozinho não diagnostica: "PROVIDER_ERROR" cabe em
          // sobrecarga, chave inválida e schema recusado. Sem a mensagem do
          // provider e o número de tentativas, uma falha de 55s registrada no
          // banco não tem como ser explicada depois — foi o que aconteceu.
          message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
          details: isAppError(outcome.error) ? outcome.error.details : undefined,
        };

    if (outcome.ok === true) this.servedTier?.record(outcome.result.tier);

    const recorded = await this.recordAiCall.execute(tenant, {
      role: request.role,
      provider: prepared.provider.name,
      model: prepared.model,
      status: failure?.status ?? 'SUCCESS',
      usage,
      // A cota que serviu: a gratuita não é cobrada, e o painel mostra dinheiro.
      // Só o sucesso sabe por qual chave saiu; a falha não chegou a ser servida.
      ...(outcome.ok === true && outcome.result.tier ? { tier: outcome.result.tier } : {}),
      ...(failure ? { errorCode: failure.errorCode } : {}),
      ...(request.policyVersionId ? { policyVersionId: request.policyVersionId } : {}),
      ...(request.policySections ? { policySections: request.policySections } : {}),
      trace: {
        runtimeVersion: RUNTIME_VERSION,
        contextCompilerVersion: CONTEXT_COMPILER_VERSION,
        promptCompilerVersion: PROMPT_COMPILER_VERSION,
        generationParams: {
          ...(request.params ?? {}),
          // Quantos pedidos foram servidos e jogados fora para esta resposta
          // sair. Sem isto, duas chamadas idênticas com custos diferentes
          // seriam indistinguíveis de um erro de cálculo.
          ...(outcome.ok === true && outcome.result.discardedAttempts
            ? { discardedAttempts: outcome.result.discardedAttempts }
            : {}),
        },
        contextBlocks: this.traceBlocks(prepared.context),
        compiledRequest: {
          model: prepared.llmRequest.model,
          systemInstruction: prepared.llmRequest.systemInstruction,
          messages: prepared.llmRequest.messages,
          params: prepared.llmRequest.params,
          cacheablePrefixLength: prepared.llmRequest.cacheablePrefixLength ?? 0,
        },
        ...(request.knowledgeRefs && request.knowledgeRefs.length > 0
          ? { knowledgeRefs: request.knowledgeRefs }
          : {}),
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        ...(request.hubOperationId ? { hubOperationId: request.hubOperationId } : {}),
        ...(failure
          ? {
              violations: [
                {
                  code: failure.errorCode,
                  message: failure.message.slice(0, 500),
                  ...(failure.details !== undefined ? { details: failure.details } : {}),
                },
              ],
            }
          : {}),
      },
    });

    return {
      aiCallId: recorded.aiCallId,
      costMicros: recorded.cost.totalMicros,
      totalTokens: usage.totalTokens,
    };
  }

  async generate(
    tenant: TenantContext,
    request: LlmGatewayRequest,
  ): Promise<LlmResult<string> & AiCallOutcome> {
    const prepared = this.prepare(request);
    const startedAt = Date.now();

    try {
      const result = await prepared.provider.generate(prepared.llmRequest);
      const outcome = await this.persist(tenant, request, prepared, { ok: true, result });
      return { ...result, ...outcome };
    } catch (error) {
      await this.persist(tenant, request, prepared, {
        ok: false,
        error,
        latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async generateStructured<T>(
    tenant: TenantContext,
    request: LlmGatewayRequest,
    schema: ZodType<T>,
  ): Promise<LlmResult<T> & AiCallOutcome> {
    const prepared = this.prepare(request);
    const startedAt = Date.now();

    if (!prepared.provider.capabilities().structuredOutput) {
      throw new AppError(
        'PROVIDER_ERROR',
        `O provider "${prepared.provider.name}" não suporta saída estruturada.`,
        { httpStatus: 503 },
      );
    }

    try {
      const result = await prepared.provider.generateStructured(prepared.llmRequest, schema);
      const outcome = await this.persist(tenant, request, prepared, { ok: true, result });
      return { ...result, ...outcome };
    } catch (error) {
      const recusada = await this.persist(tenant, request, prepared, {
        ok: false,
        error,
        latencyMs: Date.now() - startedAt,
      });

      const correction = schemaCorrection(error);
      if (!correction) throw error;

      // UMA correção. O modelo errou a FORMA, não o conteúdo: ele já fez o
      // raciocínio e omitiu um campo. Devolver o erro exato é barato e resolve
      // quase sempre — muito melhor que perder o turno inteiro do usuário.
      //
      // Por que isto acontece: quando o schema não cabe no teto do provider, a
      // decodificação deixa de ser restrita e o modelo monta a estrutura de
      // cabeça (ver `fitsGeminiSchemaLimits`). Aí omitir campo obrigatório
      // passa a ser possível.
      const retryStarted = Date.now();
      const retryPrepared = this.prepare({
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: '(resposta anterior inválida)' },
          { role: 'user', content: correction },
        ],
      });

      try {
        const result = await retryPrepared.provider.generateStructured(
          retryPrepared.llmRequest,
          schema,
        );
        const outcome = await this.persist(tenant, request, retryPrepared, { ok: true, result });
        // O turno custou as DUAS chamadas: a recusada foi gerada e cobrada.
        // Devolver só a segunda fazia o painel mostrar menos do que a fatura.
        return {
          ...result,
          ...outcome,
          costMicros: outcome.costMicros + recusada.costMicros,
          totalTokens: outcome.totalTokens + recusada.totalTokens,
        };
      } catch (retryError) {
        await this.persist(tenant, request, retryPrepared, {
          ok: false,
          error: retryError,
          latencyMs: Date.now() - retryStarted,
        });
        throw retryError;
      }
    }
  }

  /**
   * Streaming. O uso só é conhecido no chunk final, então a persistência
   * acontece depois que o stream termina — inclusive se ele terminar em erro.
   */
  async *stream(
    tenant: TenantContext,
    request: LlmGatewayRequest,
  ): AsyncIterable<LlmChunk & { aiCallId?: string }> {
    const prepared = this.prepare(request);
    const startedAt = Date.now();

    try {
      for await (const chunk of prepared.provider.stream(prepared.llmRequest)) {
        if (chunk.type !== 'done') {
          yield chunk;
          continue;
        }

        const outcome = await this.persist(tenant, request, prepared, {
          ok: true,
          result: {
            content: '',
            raw: '',
            usage: chunk.usage,
            model: prepared.model,
            finishReason: chunk.finishReason,
          },
        });

        yield { ...chunk, aiCallId: outcome.aiCallId };
      }
    } catch (error) {
      await this.persist(tenant, request, prepared, {
        ok: false,
        error,
        latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}
