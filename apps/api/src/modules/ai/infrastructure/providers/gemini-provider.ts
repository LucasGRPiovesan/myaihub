import type { GoogleGenAI, GenerateContentConfig, GenerateContentResponse } from '@google/genai';
import type { NormalizedUsage, ProviderName } from '@myaihub/shared';
import { z, type ZodType } from 'zod';
import { AppError } from '../../../../shared/domain/errors.js';
import { GeminiKeyRing, type KeyTier } from './gemini-keys.js';
import { UsageLedger } from './usage-ledger.js';
import {
  StructuredOutputError,
  type LlmChunk,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
  type ProviderCapabilities,
} from '../../domain/provider.js';
import { fitsGeminiSchemaLimits, toGeminiSchema } from './gemini-schema.js';

/**
 * Adapter do Google Gemini.
 *
 * Único lugar do projeto onde `@google/genai` pode ser importado — o lint barra
 * o import em qualquer outro caminho.
 */
/**
 * Espera entre tentativas para falha TRANSITÓRIA.
 *
 * Três tentativas no total, com espera crescente. O teto de "1 retry" da
 * arquitetura existe para controlar CUSTO, e 503/429 não custam nada: o pedido
 * não chegou a ser servido e nenhum token foi consumido. Insistir aqui é
 * gratuito e é a diferença entre o usuário perder o trabalho ou não.
 */
const RETRY_DELAYS_MS = [700, 2_200];

/**
 * Quanto tempo precisa SOBRAR para valer a pena tentar de novo.
 *
 * Repetir é gratuito em token, nunca em tempo — e essa era a metade que faltava.
 * Cada tentativa tinha o timeout INTEIRO para si, então "60s" na verdade
 * significava até 183s de espera antes do erro. Medido em produção: uma conversa
 * do Lab devolveu falha depois de 55s, e turnos que normalmente levam 1,5s
 * levaram 27s e 31s porque duas tentativas lentas falharam antes da que deu
 * certo. O usuário via lentidão sem explicação e, no fim, "deu erro".
 *
 * Agora o prazo é do PEDIDO, não da tentativa: só repete se ainda houver tempo
 * de a repetição terminar dentro dele. Sem margem, falhar agora é melhor que
 * falhar depois — a mensagem é a mesma, e o usuário recupera o turno mais cedo.
 */
const MIN_TIME_TO_RETRY_MS = 5_000;

/**
 * Silêncio tolerado ENTRE palavras, depois que o stream já começou.
 *
 * Separa "lento" de "morto". Medido em stream saudável: maior intervalo de 3,4s
 * na geração estruturada e centésimos de segundo na conversa. Num provider
 * degradado, um stream ficou 41 SEGUNDOS mudo no meio e a operação só desistiu
 * no teto de 180s — três minutos de espera por uma resposta já morta.
 *
 * Folgado de propósito: aqui não se apressa nada, só se reconhece o que parou.
 */
const MAX_SILENCE_MS = 20_000;
const STRUCTURED_MAX_SILENCE_MS = 30_000;

/**
 * Quanto esperar pela PRIMEIRA palavra de um turno de conversa.
 *
 * TODO pedido que o MyAIHub dispara tem que ser NECESSÁRIO. Houve aqui uma
 * corrida de pedidos — passados 4s de silêncio, um segundo partia ao lado do
 * primeiro, que continuava vivo — e ela cortava a cauda lenta pela metade. Mas
 * o preço é gastar por especulação: um pedido disparado sem o anterior ter
 * falhado, num sistema em que cada pedido custa dinheiro e consome cota. Foi
 * removida.
 *
 * O que ficou no lugar é sequencial e resolve o mesmo problema com um pedido
 * por vez: passado o silêncio TOTAL, mata-se este e refaz-se UM, já sabendo que
 * o anterior morreu. Se o segundo também falhar, o erro vai para a tela com o
 * botão de tentar de novo — a decisão de gastar mais uma vez é do usuário.
 *
 * ========== ONDE CORTAR, MEDIDO DUAS VEZES ==========
 *
 * O valor foi 4s, e ele MATAVA PEDIDO SAUDÁVEL: a distribuição da primeira
 * palavra é 790 · 833 · 897 · 953 · 1.144 · 1.376 · **4.357** ms, e só depois o
 * grupo morto (14.537 · 27.507 · 30.017). O corte estava 357ms ANTES da cauda
 * saudável — o pedido ia responder, era abortado, e o refeito pagava o prompt
 * de novo. Medido: 5 falhas de `agent.runtime` em 12 chamadas, todas com
 * `in0/out0`, todas em ~8,8s (4s + 4s). Nenhuma era sobrecarga do provider.
 *
 * Subiu para 8s e o problema virou outro: com a MESMA coleira na repetição, o
 * turno travado passou a custar quase dez segundos. Medido com projeto e
 * campanha carregados, o agrupamento era 9.577 · 9.637 · 9.725 · 9.783 · 9.812
 * · 10.059 ms — 8s de vigia mais ~1,5s da repetição, em quase metade dos turnos.
 *
 * A resposta não era escolher entre os dois números: era parar de usar o MESMO
 * número nas duas tentativas (ver `RETRY_FIRST_TOKEN_TIMEOUT_MS`). Aqui ficam
 * 6s — acima da cauda saudável mais lenta já observada (5.650ms) e bem abaixo
 * do grupo morto —, e a repetição fica paciente.
 */
export const CHAT_FIRST_TOKEN_TIMEOUT_MS = 6_000;

/**
 * A COLEIRA DA REPETIÇÃO É LONGA — e a da primeira tentativa é curta.
 *
 * As duas esperas não valem a mesma coisa, e tratá-las com o mesmo número era o
 * que fazia um turno travado custar quase dez segundos.
 *
 * Abandonar a PRIMEIRA tentativa é barato: ela não produziu token nenhum, logo
 * não foi cobrada, e refazer custa só o tempo. Então a coleira dela fica logo
 * acima da cauda saudável — corta cedo e recomeça.
 *
 * Abandonar a SEGUNDA é caro: significa devolver erro ao usuário depois de ele
 * já ter esperado duas vezes, e o pedido seguinte seria dele, à mão. Aqui vale
 * esperar de verdade.
 *
 * Medido no banco, com 8s nas duas: os turnos travados formavam um agrupamento
 * apertadíssimo em 9.577 · 9.637 · 9.725 · 9.783 · 9.812 · 10.059 ms — que é
 * exatamente 8s de vigia mais ~1,5s da repetição. Com 6s e 20s, o mesmo turno
 * sai em ~7,5s, e a repetição praticamente não falha mais.
 *
 * O prazo do PEDIDO continua mandando: `withTransientRetry` só repete se couber
 * a repetição inteira, e o `AbortSignal.timeout` do que resta corta antes desta
 * coleira quando o teto do papel for menor que ela.
 */
export const RETRY_FIRST_TOKEN_TIMEOUT_MS = 20_000;

/**
 * O mesmo vigia, para geração estruturada.
 *
 * Mais folgado porque o trabalho é outro: o prompt é grande, o modelo pensa
 * antes de começar a escrever, e um começo em 10s ali é normal. Ainda assim é
 * sete vezes menos do que esperar o teto de 180s por um pedido que travou —
 * foi o que produziu uma operação de 137s e outra que morreu em 55s.
 */
const STRUCTURED_FIRST_TOKEN_TIMEOUT_MS = 25_000;

/**
 * O pedido TRAVOU: nenhum token chegou dentro do prazo de primeira resposta.
 *
 * É diferente de timeout comum, e a diferença é o que autoriza repetir.
 * Medido no provider, em oito chamadas idênticas: ou a primeira palavra chega
 * em ~1s, ou não chega nunca e o pedido morre no teto. Não existe meio-termo —
 * então um pedido sem NENHUM token depois de vários segundos não está lento,
 * está travado, e não produziu saída nenhuma para ter sido cobrada.
 *
 * A regra da arquitetura — "timeout não repete, pode ter sido servido" — vale
 * para o pedido que passou a responder e não terminou. Este nunca começou.
 */
export class StalledError extends Error {
  constructor(readonly waitedMs: number) {
    super(`O provider não enviou nada em ${waitedMs}ms.`);
    this.name = 'StalledError';
  }
}

/**
 * O pedido terminou bem e não trouxe texto nenhum.
 *
 * Não é travamento: o stream ABRIU, fechou sozinho e o provider reportou fim
 * normal. Visto em produção num turno de conversa — 1,9s, 399 tokens de
 * raciocínio, ZERO de saída — e registrado como SUCCESS, entregando ao Lab uma
 * fala vazia do agente. Para quem está testando, um agente que não responde é
 * pior que um erro: o erro pelo menos diz que algo aconteceu.
 *
 * Repete, e por isso é uma classe própria: o custo de repetir são os tokens de
 * raciocínio de um turno curto, e o custo de NÃO repetir é o turno inteiro do
 * usuário. Mas repete pouco — pelo mesmo motivo do travamento, o provider que
 * devolveu vazio tende a devolver vazio de novo.
 */
export class EmptyResponseError extends Error {
  constructor(readonly finishReason: string) {
    super(`O provider terminou (${finishReason}) sem devolver texto.`);
    this.name = 'EmptyResponseError';
  }
}

/** O prazo do pedido acabou antes de a próxima tentativa sequer começar. */
class DeadlineError extends Error {
  constructor() {
    super('O prazo do pedido terminou antes de a chamada ser feita.');
    // O nome importa: é por ele que o resto do sistema reconhece um abort.
    this.name = 'TimeoutError';
  }
}

/** Informa que uma tentativa foi repetida. Existe para a espera ficar explicável. */
export interface RetryNotice {
  attempt: number;
  delayMs: number;
  remainingMs: number;
  reason: string;
}

/**
 * O provider recusou o SCHEMA, não o pedido.
 *
 * INVALID_ARGUMENT num pedido com schema restrito quer dizer que o schema
 * passou do que o serviço aceita. Não adianta repetir igual — mas adianta muito
 * repetir SEM ele, em JSON mode, que é o que faz o palpite sobre o limite
 * deixar de custar a operação inteira.
 */
export function isSchemaRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\b400\b|INVALID_ARGUMENT/i.test(error.message);
}

/**
 * Falha de disponibilidade, não de conteúdo.
 *
 * O SDK entrega o corpo do erro na mensagem, então é ali que o status aparece.
 */
export function isTransientProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return false;
  return /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(error.message);
}

/**
 * COTA esgotada — não é a mesma coisa que sobrecarga.
 *
 * 503 é o provider dizendo "estou ocupado": repetir na MESMA chave resolve. 429
 * é "você já usou o que tinha": repetir na mesma chave devolve o mesmo não, e é
 * só neste caso que trocar de chave faz sentido. Tratar os dois igual gastaria
 * a chave paga em toda oscilação do serviço.
 */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(error.message);
}

/**
 * Repete ou não, e depois de quanto tempo. `null` = desiste agora.
 *
 * Duas condições, e as duas precisam valer: o erro tem que ser transitório, e o
 * prazo tem que caber a repetição INTEIRA. A segunda faltava, e era ela que
 * transformava um soluço do provider em meio minuto de espera para o usuário.
 */
export function planRetry(error: unknown, attempt: number, msLeft: number): number | null {
  const delay = RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return null;

  const stalled = error instanceof StalledError || error instanceof EmptyResponseError;

  // Travamento e resposta vazia são repetíveis pelo mesmo motivo que 503: não
  // produziram saída aproveitável. Mas têm UMA tentativa extra, não duas.
  //
  // Medido: quando o pedido trava, ele costuma travar de novo — três travadas
  // seguidas gastaram 126s antes de o usuário receber o erro, e a terceira
  // tentativa nunca salvou nenhuma. O 503 é diferente: ali o provider RESPONDEU
  // dizendo que está ocupado, o que é sinal de vida e volta rápido.
  if (stalled && attempt >= 1) return null;

  if (!stalled && !isTransientProviderError(error)) return null;

  return msLeft - delay < MIN_TIME_TO_RETRY_MS ? null : delay;
}

export class GeminiProvider implements LlmProvider {
  readonly name: ProviderName = 'gemini';
  readonly available = true;

  /**
   * O SDK é carregado no PRIMEIRO uso, não no import.
   *
   * `@google/genai` é o módulo mais caro do projeto (~250ms de import) e o boot
   * pagava esse preço mesmo numa sessão que nunca chama o modelo. Ele também
   * seria pago por quem roda só com o FakeProvider.
   */
  private client: GoogleGenAI | null = null;

  /**
   * Um cliente POR CHAVE.
   *
   * O SDK guarda a credencial na instância, então trocar de chave é trocar de
   * cliente. Ficam em cache pela mesma razão de sempre: o import do
   * `@google/genai` é caro e não deve acontecer duas vezes.
   */
  private readonly clients = new Map<string, GoogleGenAI>();

  /** A gratuita, a paga, e até quando a gratuita está fora. */
  private readonly keys: GeminiKeyRing;

  /**
   * Dois tetos, porque são dois trabalhos diferentes.
   *
   * Um turno de conversa vive de resposta rápida: medido, ele leva ~1,5s e o
   * pior caso saudável não passa de 5s. Trinta segundos já são vinte vezes
   * isso — a partir daí não existe resposta boa, só espera, e refazer o turno
   * custa ao usuário uma tecla. Já uma geração estruturada do OS produz a
   * configuração inteira de um agente (~8.500 tokens de saída) e legitimamente
   * leva mais; usar o teto de conversa ali derrubava operações que estavam
   * CERTAS, jogando fora o raciocínio e os tokens já pagos.
   *
   * Os dois valem para o PEDIDO inteiro, retentativas incluídas.
   */
  constructor(
    private readonly apiKey: string,
    private readonly options: {
      timeoutMs?: number;
      structuredTimeoutMs?: number;
      /** Chamado a cada repetição — é o que torna a espera diagnosticável. */
      onRetry?: (notice: RetryNotice) => void;
      /**
       * A chave PAGA, usada só quando a cota gratuita do dia acabou.
       *
       * Ausente, o provider se comporta exatamente como antes de ela existir.
       */
      paidApiKey?: string | undefined;
      /** Troca de chave — vai para o log: gasto mudando de bolso se anuncia. */
      onKeySwitch?: (notice: { tier: KeyTier; until: Date | null; reason: string }) => void;
    } = {},
  ) {
    this.keys = new GeminiKeyRing(apiKey, options.paidApiKey ?? null, {
      ...(options.onKeySwitch ? { onSwitch: options.onKeySwitch } : {}),
    });
  }

  /** Qual chave está servindo agora e até quando a gratuita está fora. */
  keyStatus(): ReturnType<GeminiKeyRing['status']> {
    return this.keys.status();
  }

  /** A ESCOLHA do admin — usar a paga mesmo com a gratuita de pé. */
  setForcedPaid(value: boolean): void {
    this.keys.setForcedPaid(value);
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 30_000;
  }

  private get structuredTimeoutMs(): number {
    return this.options.structuredTimeoutMs ?? 180_000;
  }

  /**
   * O prazo desta chamada.
   *
   * Quem sabe o peso do trabalho é o gateway, pelo papel do modelo; o padrão do
   * tipo de chamada é a rede de baixo, para quando ele não disser nada.
   */
  private budget(
    request: LlmRequest,
    fallback: { stallMs: number; totalMs: number },
  ): { stallMs: number; totalMs: number } {
    return {
      stallMs: request.timing?.stallMs ?? fallback.stallMs,
      totalMs: request.timing?.totalMs ?? fallback.totalMs,
    };
  }

  /**
   * O cliente da chave que vale AGORA — e qual chave é essa.
   *
   * A escolha acontece por TENTATIVA, não por pedido: é isso que faz a
   * retentativa depois de um 429 sair pela chave paga sem que nada mais no
   * caminho precise saber que existem duas.
   */
  private async getClient(): Promise<{ client: GoogleGenAI; tier: KeyTier }> {
    const escolhida = this.keys.select();

    let client = this.clients.get(escolhida.apiKey);
    if (!client) {
      const { GoogleGenAI } = await import('@google/genai');
      client = new GoogleGenAI({ apiKey: escolhida.apiKey });
      this.clients.set(escolhida.apiKey, client);
    }

    return { client, tier: escolhida.tier };
  }

  capabilities(): ProviderCapabilities {
    return {
      caching: true,
      structuredOutput: true,
      reasoning: true,
      vision: true,
      streaming: true,
    };
  }

  private buildConfig(
    request: LlmRequest,
    signal: AbortSignal,
    json?: { schema?: unknown; instruction?: string },
  ): GenerateContentConfig {
    const config: GenerateContentConfig = {
      systemInstruction: json?.instruction
        ? `${request.systemInstruction}\n\n${json.instruction}`
        : request.systemInstruction,
      // O sinal vem de fora porque o prazo é do PEDIDO, não desta tentativa.
      abortSignal: signal,
    };

    const { temperature, topP, maxOutputTokens, stopSequences, thinkingBudget } = request.params;
    if (temperature !== undefined) config.temperature = temperature;
    if (topP !== undefined) config.topP = topP;
    if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;
    if (stopSequences?.length) config.stopSequences = stopSequences;
    if (thinkingBudget !== undefined) config.thinkingConfig = { thinkingBudget };

    if (json) {
      config.responseMimeType = 'application/json';
      if (json.schema !== undefined) config.responseJsonSchema = json.schema;
    }

    return config;
  }

  private buildContents(request: LlmRequest) {
    return request.messages.map((message) => ({
      // O Gemini chama o assistente de "model".
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        { text: message.content },
        // A imagem vai DEPOIS do texto: o texto é o pedido, a imagem é o
        // material. Invertido, o modelo tende a descrever a imagem em vez de
        // usá-la para o que foi pedido.
        ...(message.images ?? []).map((image) => ({
          inlineData: { mimeType: image.mimeType, data: image.data },
        })),
      ],
    }));
  }

  /**
   * Normaliza o uso do Gemini para a forma única (§37).
   *
   * `thoughtsTokenCount` (raciocínio) já vem embutido em `candidatesTokenCount`
   * na resposta da API, então o descontamos do output para não cobrar duas vezes.
   */
  private emptyUsage(latencyMs: number): NormalizedUsage {
    return {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      toolCalls: 0,
      totalTokens: 0,
      latencyMs,
    };
  }

  private normalizeUsage(response: GenerateContentResponse, latencyMs: number): NormalizedUsage {
    const usage = response.usageMetadata;

    const cachedInputTokens = usage?.cachedContentTokenCount ?? 0;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const reasoningTokens = usage?.thoughtsTokenCount ?? 0;
    const candidates = usage?.candidatesTokenCount ?? 0;
    const outputTokens = Math.max(0, candidates - reasoningTokens);

    return {
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens: 0,
      outputTokens,
      reasoningTokens,
      toolCalls: 0,
      totalTokens: usage?.totalTokenCount ?? inputTokens + candidates,
      latencyMs,
    };
  }

  /**
   * Retentativas para falha TRANSITÓRIA do provider, dentro de um PRAZO.
   *
   * 503 ("high demand") e 429 significam que o pedido não chegou a ser servido:
   * não gastou token e não produziu resposta. Derrubar a operação inteira por
   * isso faz o usuário perder o que escreveu por um soluço de infraestrutura.
   *
   * O prazo é do pedido inteiro: cada tentativa recebe o tempo que RESTA, e a
   * repetição só acontece se sobrar margem para ela terminar. É o que faz "30s"
   * significar 30s.
   *
   * Nunca repete erro de conteúdo: seria pagar para receber o mesmo "não"
   * (§16, risco 3).
   */
  private async withTransientRetry<T>(
    deadlineAt: number,
    tries: { count: number },
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      tries.count = attempt + 1;

      const remaining = deadlineAt - Date.now();
      // Já não há tempo nem para a chamada: aborta com o mesmo erro de sempre.
      if (remaining <= 0) throw new DeadlineError();

      try {
        return await run(AbortSignal.timeout(remaining));
      } catch (error) {
        const delay = planRetry(error, attempt, deadlineAt - Date.now());
        // Erro de conteúdo, ou prazo curto demais: repetir só adiaria o mesmo
        // erro, e o usuário esperaria o dobro para receber a mesma frase.
        if (delay === null) throw error;

        this.options.onRetry?.({
          attempt: attempt + 1,
          delayMs: delay,
          remainingMs: deadlineAt - Date.now() - delay,
          reason: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Traduz a falha do provider para algo sobre o que se possa AGIR.
   *
   * Sobrecarga e limite de taxa ganham código próprio: a ação certa ali é
   * esperar e repetir, não corrigir nada. Enquanto tudo virava PROVIDER_ERROR
   * ("Falha ao chamar o provider"), a tela dizia ao usuário que algo quebrou
   * quando na verdade o modelo só estava ocupado.
   *
   * `attempts` viaja nos detalhes porque é o que explica a espera: uma falha em
   * 27s com três tentativas é um problema diferente de uma falha em 27s com uma.
   */
  private wrapError(error: unknown, attempts: number): never {
    if (error instanceof AppError) throw error;

    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      error instanceof DeadlineError ||
      (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'));

    const empty = error instanceof EmptyResponseError;
    const stalled = error instanceof StalledError || empty;
    const transient = isTransientProviderError(error) || stalled;

    // A mensagem tem que dizer o que de fato aconteceu. "Sobrecarregado" numa
    // resposta vazia manda quem for investigar procurar no lugar errado — foi
    // exatamente assim que uma falha de 55s ficou sem explicação por horas.
    throw new AppError(
      isTimeout ? 'PROVIDER_TIMEOUT' : transient ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
      isTimeout
        ? 'O provider não respondeu a tempo.'
        : empty
          ? 'O modelo terminou sem escrever nada. Tente de novo.'
          : /*
              TRAVAMENTO NÃO É SOBRECARGA, e dizer que é manda quem investiga
              para o lugar errado — o mesmo motivo pelo qual a resposta vazia já
              tem mensagem própria.

              "Sobrecarregado" é uma AFIRMAÇÃO sobre o provider, e ela só se
              sustenta quando ELE disse isso: um 503 ou 429. Um `StalledError` é
              o contrário — foi o NOSSO vigia que desistiu de esperar a primeira
              palavra, e o provider nunca chegou a responder nada. Enquanto os
              dois tinham o mesmo texto, um vigia mal calibrado aparecia na tela
              como culpa do Google, e foi assim que um `CHAT_FIRST_TOKEN_TIMEOUT`
              apertado demais passou despercebido matando pedido saudável.
            */
            stalled
            ? 'O modelo demorou demais para começar a responder. Tente de novo.'
            : transient
              ? 'O modelo está sobrecarregado agora. Tente de novo em alguns segundos.'
              : 'Falha ao chamar o provider.',
      {
        httpStatus: transient ? 503 : 502,
        cause: error,
        details: { provider: 'gemini', message, attempts },
      },
    );
  }

  /**
   * Uma tentativa de conversa, lida por stream e vigiada.
   *
   * O stream não existe aqui para mostrar texto aparecendo: existe para SABER
   * se o pedido começou a ser respondido. Sem ele, um pedido travado é
   * indistinguível de um pedido lento, e a única saída é esperar o teto inteiro.
   */
  private async readWatched(
    request: LlmRequest,
    signal: AbortSignal,
    /**
     * Silêncio tolerado ANTES da primeira palavra. Passado ele, este pedido
     * está morto: aborta, e quem chama decide se refaz UM no lugar.
     */
    stallMs: number | null,
    /**
     * Silêncio tolerado ENTRE palavras, depois que o stream já começou.
     *
     * Vigia diferente, para uma falha diferente. Medido no provider degradado:
     * um stream começou em 913ms, escreveu, e ficou 41 SEGUNDOS mudo no meio.
     * O vigia de primeira palavra não pega isso — ele já tinha sido satisfeito —
     * e a operação seguia até o teto de 180s antes de desistir. O usuário
     * esperava três minutos por uma resposta que já tinha morrido.
     *
     * Num stream saudável o maior intervalo medido foi 3,4s na geração
     * estruturada e centésimos na conversa. Estes tetos são folgados de
     * propósito: servem para separar "lento" de "morto", não para apressar.
     */
    silenceMs: number,
    json?: { schema?: unknown; instruction?: string },
    /**
     * Onde ESTA tentativa anota o que o provider disse ter consumido.
     *
     * Fica fora do valor de retorno de propósito: a tentativa que perde a
     * corrida nunca retorna — ela é abortada —, e é justamente o consumo dela
     * que se perdia. Anotando durante o stream, o que o provider informou
     * sobrevive ao descarte.
     */
    ledger?: { record: (attempt: number, usage: NormalizedUsage) => void; attempt: number },
  ): Promise<{
    text: string;
    usage: NormalizedUsage;
    finishReason: string;
    tier: KeyTier;
  }> {
    const startedAt = Date.now();
    const { client, tier } = await this.getClient();

    const stall = new AbortController();
    let arrived = false;
    let mudoDesde = Date.now();

    // Um vigia só, relido a cada palavra: antes da primeira ele cobra
    // `stallMs`, depois dela cobra `silenceMs`.
    const watchdog = setInterval(() => {
      const teto = arrived ? silenceMs : stallMs;
      if (teto !== null && Date.now() - mudoDesde > teto) stall.abort();
    }, 500);

    try {
      const stream = await client.models.generateContentStream({
        model: request.model,
        contents: this.buildContents(request),
        config: this.buildConfig(request, AbortSignal.any([signal, stall.signal]), json),
      });

      const parts: string[] = [];
      let last: GenerateContentResponse | undefined;

      for await (const chunk of stream) {
        last = chunk;

        // O consumo é anotado A CADA pedaço, não no fim: se esta tentativa for
        // abortada por perder a corrida, o que ela já tinha informado continua
        // valendo. O `usageMetadata` do stream é acumulado, então a anotação
        // mais recente substitui a anterior em vez de somar.
        if (ledger && chunk.usageMetadata) {
          ledger.record(ledger.attempt, this.normalizeUsage(chunk, Date.now() - startedAt));
        }

        const text = chunk.text;
        if (text) {
          arrived = true;
          mudoDesde = Date.now();
          parts.push(text);
        }
      }

      const text = parts.join('');
      const finishReason = last?.candidates?.[0]?.finishReason ?? 'stop';

      // Terminou bem e não trouxe nada. Devolver isso como sucesso entrega uma
      // fala vazia ao Lab — o agente "não responde", que é o pior desfecho
      // possível para quem está justamente testando se ele responde.
      if (!text) throw new EmptyResponseError(String(finishReason));

      // A gratuita respondeu: se ela estava marcada como fora, volta a valer.
      // É a outra metade da meia-abertura — sem isso, um prazo estimado longo
      // demais manteria a paga em uso depois de a cota já ter voltado.
      this.keys.reportSuccess(tier);

      // A leitura FINAL vale para o razão mesmo que nenhum pedaço tenha trazido
      // `usageMetadata` pelo caminho — e é o caso comum: o Gemini costuma
      // mandar o consumo só no último. Sem esta linha, a tentativa que
      // terminou bem entrava na conta como zero.
      const usage = last
        ? this.normalizeUsage(last, Date.now() - startedAt)
        : this.emptyUsage(Date.now() - startedAt);
      ledger?.record(ledger.attempt, usage);

      return {
        text,
        usage,
        finishReason,
        tier,
      };
    } catch (error) {
      // 429/RESOURCE_EXHAUSTED na gratuita: ela sai de cena até a cota voltar,
      // e a retentativa que já existe para erro transitório pega a paga. O
      // usuário não vê nada disso — nem o erro, nem a troca.
      if (isQuotaError(error)) this.keys.reportExhausted(tier, error);

      // Abortado pelo vigia, e não pelo prazo do pedido: travou antes de
      // começar. Vira erro próprio para poder ser repetido.
      // Abortado pelo vigia, e não pelo prazo do pedido. Os dois casos viram
      // `StalledError` porque a ação certa é a mesma — refazer — mas o número
      // no erro diz qual dos dois foi, e é ele que aparece no trace.
      if (stall.signal.aborted) {
        if (!arrived && stallMs !== null) throw new StalledError(stallMs);
        if (arrived) throw new StalledError(silenceMs);
      }
      throw error;
    } finally {
      clearInterval(watchdog);
    }
  }

  async generate(request: LlmRequest): Promise<LlmResult<string>> {
    const budget = this.budget(request, {
      stallMs: CHAT_FIRST_TOKEN_TIMEOUT_MS,
      totalMs: this.timeoutMs,
    });
    const deadlineAt = Date.now() + budget.totalMs;
    const tries = { count: 0 };
    const startedAt = Date.now();
    // TODAS as tentativas desta chamada anotam aqui. O que vai para a conta é
    // a soma do que o provider informou — nunca uma estimativa nossa.
    const ledger = new UsageLedger();

    try {
      // UM pedido por vez. Se ele travar, o vigia mata e a repetição acontece
      // DEPOIS da falha — nunca ao lado de um pedido que ainda pode responder.
      const read = await this.withTransientRetry(deadlineAt, tries, (signal) =>
        this.readWatched(
          request,
          signal,
          // A primeira tentativa tem coleira curta; a repetição, longa.
          // Ver `RETRY_FIRST_TOKEN_TIMEOUT_MS`.
          tries.count === 1
            ? budget.stallMs
            : Math.max(budget.stallMs, RETRY_FIRST_TOKEN_TIMEOUT_MS),
          MAX_SILENCE_MS,
          undefined,
          {
            record: (attempt, usage) => ledger.record(attempt, usage),
            attempt: tries.count,
          },
        ),
      );

      return {
        content: read.text,
        raw: read.text,
        usage: ledger.total(Date.now() - startedAt),
        model: request.model,
        finishReason: read.finishReason,
        tier: read.tier,
        discardedAttempts: Math.max(0, ledger.reported - 1),
      };
    } catch (error) {
      this.wrapError(error, tries.count);
    }
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmChunk> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + this.timeoutMs;
    const tries = { count: 0 };

    try {
      const { client } = await this.getClient();
      const stream = await this.withTransientRetry(deadlineAt, tries, (signal) =>
        client.models.generateContentStream({
          model: request.model,
          contents: this.buildContents(request),
          config: this.buildConfig(request, signal),
        }),
      );

      let last: GenerateContentResponse | undefined;

      for await (const chunk of stream) {
        last = chunk;
        const text = chunk.text;
        if (text) yield { type: 'text', text };
      }

      yield {
        type: 'done',
        usage: last
          ? this.normalizeUsage(last, Date.now() - startedAt)
          : this.emptyUsage(Date.now() - startedAt),
        finishReason: last?.candidates?.[0]?.finishReason ?? 'stop',
      };
    } catch (error) {
      this.wrapError(error, tries.count);
    }
  }

  /**
   * Decide COMO pedir JSON ao Gemini.
   *
   * Schema simples: `responseJsonSchema`, que dá decodificação restrita — o
   * modelo fisicamente não consegue produzir outra forma.
   *
   * Schema complexo: o Gemini recusa com INVALID_ARGUMENT acima de um teto de
   * complexidade (medido: ~14 propriedades). Aí degradamos para JSON mode com
   * o schema DESCRITO na instrução. Perde-se a garantia de decodificação, não a
   * de validação: o Zod continua rejeitando qualquer saída fora do contrato.
   *
   * A alternativa seria simplificar o contrato canônico para caber no limite de
   * um provider — deixar a ferramenta ditar o domínio, exatamente ao contrário
   * do que a arquitetura exige (§36).
   */
  private jsonConfigFor<T>(schema: ZodType<T>): { schema?: unknown; instruction?: string } {
    const adapted = toGeminiSchema(this.toJsonSchema(schema));
    if (fitsGeminiSchemaLimits(adapted)) return { schema: adapted };
    return this.jsonInstructionFor(schema);
  }

  /**
   * JSON mode: o schema vai DESCRITO na instrução, sem decodificação restrita.
   *
   * Vai o schema ADAPTADO, não o cru — e a diferença é grande: medido no
   * contrato de criação de agente, 2.694 tokens contra 723. A união
   * discriminada crua repete os campos comuns em cada um dos dez membros; a
   * versão achatada diz a mesma coisa uma vez e explica os `kind` na
   * `description`.
   *
   * São ~2 mil tokens de prompt em TODA operação — pagos em toda chamada, e
   * competindo com a instrução pelo que o modelo consegue reter.
   */
  private jsonInstructionFor<T>(schema: ZodType<T>): { instruction: string } {
    return {
      instruction: [
        'Responda EXCLUSIVAMENTE com JSON válido que satisfaça este JSON Schema.',
        'Sem texto antes ou depois, sem cercas de código.',
        'A ORDEM das propriedades importa: escreva-as na ordem em que aparecem.',
        '',
        JSON.stringify(toGeminiSchema(this.toJsonSchema(schema))),
      ].join('\n'),
    };
  }

  /**
   * O JSON Schema do que o modelo deve PRODUZIR.
   *
   * `io: 'input'` porque o que ele produz é a ENTRADA do nosso schema: é o
   * texto que o Zod vai parsear. Com `io: 'output'` o schema descreveria o
   * resultado DEPOIS de defaults e transformações — e aí todo campo com
   * `.default()` aparece como obrigatório, exigindo do modelo justamente o que
   * o código já sabe preencher sozinho.
   */
  private toJsonSchema<T>(schema: ZodType<T>): unknown {
    return z.toJSONSchema(schema, { io: 'input' });
  }

  async generateStructured<T>(request: LlmRequest, schema: ZodType<T>): Promise<LlmResult<T>> {
    const budget = this.budget(request, {
      stallMs: STRUCTURED_FIRST_TOKEN_TIMEOUT_MS,
      totalMs: this.structuredTimeoutMs,
    });
    const deadlineAt = Date.now() + budget.totalMs;
    const tries = { count: 0 };
    const startedAt = Date.now();
    // Vale para a estruturada pelo mesmo motivo: a retentativa por travamento
    // também é um pedido servido, e o que ele consumiu tem que entrar na conta.
    const ledger = new UsageLedger();

    try {
      let json = this.jsonConfigFor(schema);

      /**
       * Uma tentativa por vez, com o vigia de primeira palavra do papel.
       *
       * Quem decide quanto esperar é o gateway, pelo papel: a criação de um
       * agente pensa por vários segundos antes de escrever e merece 25s; o
       * auditor de aderência devolve mil tokens e, aos 6s calado, já está
       * morto — e ali o teto do papel nem deixa a repetição caber, porque o
       * turno do usuário não pode ficar meio minuto parado por uma conferência.
       */
      const leia = (signal: AbortSignal, config: typeof json) =>
        this.readWatched(request, signal, budget.stallMs, STRUCTURED_MAX_SILENCE_MS, config, {
          record: (attempt, usage) => ledger.record(attempt, usage),
          // Uma tentativa por vez: o número dela é o da retentativa, e cada
          // uma anota o próprio consumo sob o próprio índice.
          attempt: tries.count,
        });

      let read;
      try {
        read = await this.withTransientRetry(deadlineAt, tries, (signal) => leia(signal, json));
      } catch (error) {
        // O provider RECUSOU o schema. A heurística de "cabe" é um palpite
        // sobre um limite que é do serviço, não nosso — e quando ela erra, o
        // custo não pode ser a operação inteira. Repetimos em JSON mode, que é
        // o mesmo caminho de quando já sabemos que não cabe.
        //
        // Isto é o que torna seguro afrouxar o teto de complexidade: tentar
        // decodificação restrita passa a custar, no pior caso, uma requisição.
        if (!isSchemaRejection(error) || json.schema === undefined) throw error;

        this.options.onRetry?.({
          attempt: tries.count,
          delayMs: 0,
          remainingMs: deadlineAt - Date.now(),
          reason: 'schema recusado pelo provider; repetindo em JSON mode',
        });

        json = this.jsonInstructionFor(schema);
        read = await this.withTransientRetry(deadlineAt, tries, (signal) => leia(signal, json));
      }

      const raw = read.text;
      // A saída recusada por schema CUSTOU, e custou todas as tentativas que
      // foram servidas até aqui — é o razão, não só a última leitura, que diz
      // isso. Vai dentro do erro para o `ai_calls` gravar a conta certa de um
      // turno que falhou.
      const usage = ledger.total(Date.now() - startedAt);

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        // O modelo prometeu JSON e devolveu outra coisa. Não tentamos "consertar"
        // o texto: uma correção heurística pode inventar dados que o usuário
        // nunca pediu. Falha explícita, e quem chama decide se tenta de novo.
        throw new StructuredOutputError('O provider não devolveu JSON válido.', usage, {
          raw: raw.slice(0, 400),
        });
      }

      const parsed = schema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new StructuredOutputError(
          'Saída estruturada não bate com o schema.',
          usage,
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }

      return {
        content: parsed.data,
        raw,
        usage,
        model: request.model,
        finishReason: read.finishReason,
        tier: read.tier,
        discardedAttempts: Math.max(0, ledger.reported - 1),
      };
    } catch (error) {
      this.wrapError(error, tries.count);
    }
  }
}
