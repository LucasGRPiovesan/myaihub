/**
 * Contratos de IA compartilhados entre api e web.
 *
 * Só o que o frontend precisa conhecer. A forma interna de request/response dos
 * providers vive na API e nunca vaza para cá — é justamente o que mantém o
 * sistema provider-agnostic (§36).
 */

/**
 * Papel da chamada, não o modelo.
 *
 * O código pede `hub.reasoning`; qual provider e qual modelo atendem isso é
 * decisão de configuração, não de quem chama (§10 da arquitetura).
 */
export const MODEL_ROLES = [
  'hub.reasoning',
  'hub.fast',
  'agent.runtime',
  'validation.fast',
  'analysis.vision',
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const PROVIDER_NAMES = ['fake', 'gemini', 'openai', 'anthropic'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/**
 * O TIPO de chave — nem todo provider tem os mesmos.
 *
 * Só o Gemini distingue gratuita de paga: é o único com cota diária de
 * verdade neste sistema. OpenAI e Anthropic são sempre pagos, então uma chave
 * só (`DEFAULT`) basta — inventar um par FREE/PAID para eles criaria um campo
 * que ninguém preenche e uma pergunta ("qual é a gratuita da OpenAI?") que não
 * tem resposta.
 */
export const PROVIDER_KEY_KINDS = ['DEFAULT', 'FREE', 'PAID'] as const;
export type ProviderKeyKind = (typeof PROVIDER_KEY_KINDS)[number];

/** Quais tipos de chave cada provider aceita, e o rótulo de cada um na tela. */
export const PROVIDER_KEY_SLOTS: Record<
  ProviderName,
  Array<{ kind: ProviderKeyKind; label: string }>
> = {
  fake: [],
  gemini: [
    { kind: 'FREE', label: 'Chave gratuita' },
    { kind: 'PAID', label: 'Chave paga' },
  ],
  openai: [{ kind: 'DEFAULT', label: 'Chave de API' }],
  anthropic: [{ kind: 'DEFAULT', label: 'Chave de API' }],
};

/** Uso normalizado de uma chamada, na mesma forma para todos os providers (§37). */
export interface NormalizedUsage {
  inputTokens: number;
  /** Parte do input que veio de cache do provider (cobrada mais barato, ou nada). */
  cachedInputTokens: number;
  /** Tokens gravados no cache nesta chamada. */
  cacheWriteTokens: number;
  outputTokens: number;
  /** Tokens de raciocínio, quando o modelo os reporta separadamente. */
  reasoningTokens: number;
  toolCalls: number;
  totalTokens: number;
  latencyMs: number;
}

/** Custo calculado com o preço vigente NO MOMENTO da chamada (§38). */
export interface CalculatedCost {
  /** Em unidades mínimas da moeda (micros) — evita erro de ponto flutuante. */
  totalMicros: number;
  inputMicros: number;
  outputMicros: number;
  currency: 'USD';
}

/**
 * O CATÁLOGO de providers e modelos que o admin pode escolher.
 *
 * Vive aqui, e não em cada lado, pela regra de sempre: tipo que atravessa API e
 * web declarado duas vezes diverge na primeira mudança — e o sintoma é a tela
 * oferecer um modelo que a API recusa.
 *
 * Estar no catálogo NÃO significa estar disponível. Quem decide isso é a CHAVE:
 * o provider sem chave configurada é registrado como indisponível e aparece na
 * tela desligado, com o motivo. É por isso que OpenAI e Anthropic já estão aqui
 * inteiros: quando a chave entrar, não há código a escrever — só a tela a
 * recarregar.
 */
export interface ModelOption {
  id: string;
  label: string;
  /** O que este modelo é bom em fazer, em uma linha. Aparece na tela. */
  note: string;
}

export interface ProviderCatalogEntry {
  provider: ProviderName;
  label: string;
  /** Variável de ambiente que habilita este provider. A tela diz qual falta. */
  envKey: string;
  models: ModelOption[];
}

export const AI_MODEL_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: 'gemini',
    label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    models: [
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Flash-Lite',
        note: 'o mais rápido e barato — é o que a cota gratuita serve',
      },
      { id: 'gemini-3.5-flash', label: 'Flash', note: 'equilíbrio entre custo e capacidade' },
      { id: 'gemini-3.5-pro', label: 'Pro', note: 'raciocínio mais longo, custo bem maior' },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', note: 'rápido, para trabalho curto' },
      { id: 'gpt-4.1', label: 'GPT-4.1', note: 'uso geral' },
      { id: 'o4-mini', label: 'o4-mini', note: 'raciocínio, para saída estruturada difícil' },
    ],
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', note: 'rápido, para trabalho curto' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'uso geral' },
      { id: 'claude-opus-5', label: 'Opus 5', note: 'o mais capaz, custo bem maior' },
    ],
  },
];

/**
 * O modelo que a COTA GRATUITA serve.
 *
 * Enquanto ela estiver de pé, a escolha fica travada aqui: gastar num modelo
 * pago tendo requisição gratuita disponível é queimar dinheiro por opção de
 * tela. Esgotada a cota, a escolha do admin passa a valer — porque aí já se
 * está pagando de qualquer jeito, e vale escolher bem.
 */
export const FREE_TIER_ROUTE = {
  provider: 'gemini' as ProviderName,
  model: 'gemini-3.5-flash-lite',
};

/** O papel, em português, para a tela do admin. */
export const MODEL_ROLE_LABELS: Record<ModelRole, { label: string; note: string }> = {
  'hub.reasoning': {
    label: 'Raciocínio do S.O',
    note: 'criar e ajustar agente, projeto, campanha e ofício',
  },
  'hub.fast': { label: 'Perguntas do briefing', note: 'as perguntas antes de criar um agente' },
  'agent.runtime': { label: 'Fala do agente', note: 'o Lab e o chat público' },
  'validation.fast': { label: 'Auditoria de regra', note: 'confere se a resposta cumpriu as HARD' },
  'analysis.vision': { label: 'Leitura de imagem', note: 'o print colado no painel' },
};
