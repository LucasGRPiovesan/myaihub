import type { NormalizedUsage, ProviderName } from '@myaihub/shared';
import type { ZodType } from 'zod';
import { AppError } from '../../../shared/domain/errors.js';

/**
 * Port dos providers de LLM (§36).
 *
 * Nenhum domínio depende de SDK. As implementações vivem em
 * `modules/ai/infrastructure/providers` e o lint impede import de SDK fora dali.
 */

export interface GenerationParams {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  /** Orçamento de raciocínio, para modelos que suportam. */
  thinkingBudget?: number;
  stopSequences?: string[];
}

/**
 * NÃO declare `thinkingBudget` no turno de conversa. Medido, e o inverso do
 * que a intuição diz.
 *
 * Neste modelo o campo não é um TETO: declarar um valor baixo LIGA um passe de
 * raciocínio que, sem o campo, simplesmente não acontece — e o valor declarado
 * nem é respeitado. Medido com o prompt real de um agente (1.324 tokens), três
 * turnos de conversa:
 *
 *   com `thinkingBudget: 128`   2,5s · 14,0s · 2,7s   raciocínio 371 · 379 · 500
 *   sem o campo                 1,0s ·  0,7s · 21,3s  raciocínio   0 ·   0 ·   0
 *
 * (o 21,3s é travamento do provider, tratado por `StalledError`, não pensamento)
 *
 * O erro de leitura que levou a declará-lo: a primeira medição usou um prompt
 * de brinquedo, SEM instrução de sistema — que não dispara raciocínio de
 * qualquer jeito. Medir a otimização fora do caso real mede outra coisa.
 *
 * `thinkingBudget: 0` também não serve: é recusado com 400 INVALID_ARGUMENT.
 * Este modelo não desliga o raciocínio por configuração — ele só não raciocina
 * quando ninguém pede. Então não peça.
 */

export type MessageRole = 'user' | 'assistant';

/**
 * Imagem anexada a uma fala.
 *
 * Conteúdo de terceiro por natureza: um print pode conter texto que tenta se
 * passar por instrução. O adapter a coloca como PARTE DE DADO da mensagem do
 * usuário, jamais na instrução de sistema (§9.1).
 */
export interface LlmImagePart {
  mimeType: string;
  /** Base64 puro, sem o prefixo `data:`. */
  data: string;
}

export interface LlmMessage {
  role: MessageRole;
  content: string;
  images?: LlmImagePart[];
}

export interface LlmRequest {
  model: string;
  /** Região de INSTRUÇÕES. Conteúdo untrusted nunca chega aqui (§9.1). */
  systemInstruction: string;
  messages: LlmMessage[];
  params: GenerationParams;
  /** Marca o prefixo estável como cacheável; cada adapter aplica do seu jeito. */
  cacheablePrefixLength?: number;
  /**
   * Tetos de tempo desta chamada, quando o padrão do provider não serve.
   *
   * Quem decide é o GATEWAY, a partir do papel do modelo: o papel já significa
   * "quão pesado é este trabalho", e é a mesma informação que diz quanto vale a
   * pena esperar. O provider só obedece.
   *
   * Sem isto, uma chamada curta herdava o teto da geração pesada: o briefing de
   * criação de agente — que produz três perguntas — esperava 25s por tentativa,
   * três vezes, e falhava depois de 78 segundos. Medido em produção.
   */
  timing?: {
    /** Quanto esperar pela PRIMEIRA palavra antes de considerar travado. */
    stallMs?: number;
    /** Teto do pedido inteiro, retentativas incluídas. */
    totalMs?: number;
  };
}

export interface LlmResult<T = string> {
  content: T;
  /** Texto cru devolvido, mesmo quando `content` é estruturado. */
  raw: string;
  usage: NormalizedUsage;
  model: string;
  finishReason: string;
  /**
   * A chamada foi servida pela cota GRATUITA ou pela paga.
   *
   * Existe porque o custo precisa ser verdade. O mesmo modelo, na mesma
   * requisição, custa dinheiro por uma chave e zero pela outra — e o painel
   * passou a mostrar "quanto você está gastando" no cabeçalho. Precificar o
   * turno gratuito pelo preço de tabela inventaria uma despesa que não existe,
   * bem no número que existe para ser confiável.
   *
   * Ausente quando o provider não tem essa distinção (é o caso do Fake).
   */
  tier?: 'FREE' | 'PAID';
  /**
   * Quantas tentativas ANTERIORES foram servidas antes desta responder.
   *
   * Só há repetição SEQUENCIAL, e só depois de uma falha — nenhum pedido é
   * disparado enquanto outro ainda pode responder. Mas o pedido que travou
   * consumiu o prompt antes de emudecer, e o que ele consumiu está somado no
   * `usage`. Este número existe para o trace explicar por que uma chamada
   * custou o dobro de outra idêntica. Zero na esmagadora maioria dos turnos.
   */
  discardedAttempts?: number;
}

export type LlmChunk =
  { type: 'text'; text: string } | { type: 'done'; usage: NormalizedUsage; finishReason: string };

export interface ProviderCapabilities {
  caching: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  vision: boolean;
  streaming: boolean;
}

export interface LlmProvider {
  readonly name: ProviderName;
  /**
   * Falso quando falta chave. O provider continua REGISTRADO e falha com
   * PROVIDER_NOT_CONFIGURED ao ser usado — o boot nunca quebra por falta de
   * chave (§10).
   */
  readonly available: boolean;

  capabilities(): ProviderCapabilities;
  generate(request: LlmRequest): Promise<LlmResult<string>>;
  stream(request: LlmRequest): AsyncIterable<LlmChunk>;
  generateStructured<T>(request: LlmRequest, schema: ZodType<T>): Promise<LlmResult<T>>;
}

/**
 * A saída não bateu com o schema — e o que ela CUSTOU.
 *
 * O provider gerou, cobrou e respondeu; quem recusou fomos nós, ao validar. A
 * falha genérica registrava `in=0 out=0`, então a geração mais cara do sistema
 * — uma criação de agente recusada, 105s e alguns milhares de tokens de saída —
 * entrava no banco como se não tivesse custado nada.
 *
 * É o contrário do que o produto promete: o painel mostra a conta enquanto ela
 * é feita, e o turno que o usuário mais sente é justamente o que falhou. Também
 * é o que permite responder depois "quanto nos custou o modelo errar a forma".
 */
export class StructuredOutputError extends AppError {
  readonly usage: NormalizedUsage;

  constructor(message: string, usage: NormalizedUsage, details?: unknown) {
    super('STRUCTURED_OUTPUT_INVALID', message, {
      httpStatus: 502,
      ...(details !== undefined ? { details } : {}),
    });
    this.usage = usage;
  }
}
