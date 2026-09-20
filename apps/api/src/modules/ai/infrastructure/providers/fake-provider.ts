import type { NormalizedUsage, ProviderName } from '@myaihub/shared';
import type { ZodType } from 'zod';
import { AppError } from '../../../../shared/domain/errors.js';
import type {
  LlmChunk,
  LlmProvider,
  LlmRequest,
  LlmResult,
  ProviderCapabilities,
} from '../../domain/provider.js';

/**
 * Resposta roteirizada. `match` decide se este roteiro atende o request.
 */
export interface FakeScript {
  /** Quando ausente, atende qualquer request. */
  match?: (request: LlmRequest) => boolean;
  /** Texto devolvido; para structured output, deve ser JSON válido. */
  respond: string | ((request: LlmRequest) => string);
  /** Simula falha do provider. */
  fail?: { code: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT'; message: string };
  usage?: Partial<NormalizedUsage>;
}

/**
 * FakeProvider — PERMANENTE, não andaime (§10 dos ajustes).
 *
 * Todo teste automatizado roda contra ele. Mesmo com todas as chaves reais
 * configuradas, nenhum unit/integration/E2E deve consumir API paga: testes que
 * gastam dinheiro acabam sendo desligados, e suíte desligada não protege nada.
 *
 * É determinístico: mesmo request, mesma resposta, mesmo uso reportado.
 */
export class FakeProvider implements LlmProvider {
  readonly name: ProviderName = 'fake';
  readonly available = true;

  private readonly scripts: FakeScript[] = [];
  /** Todo request recebido, para os testes inspecionarem o que foi enviado. */
  readonly requests: LlmRequest[] = [];

  constructor(scripts: FakeScript[] = []) {
    this.scripts.push(...scripts);
  }

  capabilities(): ProviderCapabilities {
    return {
      caching: true,
      structuredOutput: true,
      reasoning: false,
      // Aceita e REGISTRA partes de imagem em `requests`, que é o que um provider
      // com visão faz do ponto de vista do contrato. Declarar false aqui e
      // receber imagens seria um dublê mentindo sobre si mesmo.
      vision: true,
      streaming: true,
    };
  }

  script(script: FakeScript): this {
    this.scripts.push(script);
    return this;
  }

  reset(): void {
    this.scripts.length = 0;
    this.requests.length = 0;
  }

  private resolve(request: LlmRequest): FakeScript {
    const found = this.scripts.find((script) => !script.match || script.match(request));
    if (found) return found;

    // Eco previsível: mantém o provider utilizável sem roteiro para testes que
    // não se importam com o conteúdo da resposta.
    return { respond: `[fake] ${request.messages.at(-1)?.content ?? ''}`.trim() };
  }

  private usageFor(
    request: LlmRequest,
    text: string,
    overrides?: Partial<NormalizedUsage>,
  ): NormalizedUsage {
    const inputTokens = Math.ceil(
      (request.systemInstruction.length +
        request.messages.reduce((total, message) => total + message.content.length, 0)) /
        4,
    );
    const outputTokens = Math.ceil(text.length / 4);

    const usage: NormalizedUsage = {
      inputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens,
      reasoningTokens: 0,
      toolCalls: 0,
      totalTokens: inputTokens + outputTokens,
      latencyMs: 1,
      ...overrides,
    };

    // Coerência: quem sobrescreve entradas parciais não deve produzir um total
    // que não bate com as partes.
    if (!overrides?.totalTokens) {
      usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.reasoningTokens;
    }

    return usage;
  }

  private textFor(script: FakeScript, request: LlmRequest): string {
    if (script.fail) {
      throw new AppError(script.fail.code, script.fail.message, { httpStatus: 502 });
    }
    return typeof script.respond === 'function' ? script.respond(request) : script.respond;
  }

  async generate(request: LlmRequest): Promise<LlmResult<string>> {
    this.requests.push(request);
    const script = this.resolve(request);
    const text = this.textFor(script, request);

    return {
      content: text,
      raw: text,
      usage: this.usageFor(request, text, script.usage),
      model: request.model,
      finishReason: 'stop',
    };
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmChunk> {
    this.requests.push(request);
    const script = this.resolve(request);
    const text = this.textFor(script, request);

    // Fatia em pedaços para exercitar o consumo incremental de verdade — um
    // stream que entrega tudo de uma vez não testa o reducer da UI.
    const size = Math.max(1, Math.ceil(text.length / 5));
    for (let index = 0; index < text.length; index += size) {
      yield { type: 'text', text: text.slice(index, index + size) };
    }

    yield { type: 'done', usage: this.usageFor(request, text, script.usage), finishReason: 'stop' };
  }

  async generateStructured<T>(request: LlmRequest, schema: ZodType<T>): Promise<LlmResult<T>> {
    this.requests.push(request);
    const script = this.resolve(request);
    const text = this.textFor(script, request);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new AppError(
        'STRUCTURED_OUTPUT_INVALID',
        'O roteiro do FakeProvider não é JSON válido.',
        {
          httpStatus: 502,
          details: { raw: text.slice(0, 400) },
        },
      );
    }

    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AppError('STRUCTURED_OUTPUT_INVALID', 'Saída estruturada não bate com o schema.', {
        httpStatus: 502,
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return {
      content: parsed.data,
      raw: text,
      usage: this.usageFor(request, text, script.usage),
      model: request.model,
      finishReason: 'stop',
    };
  }
}
