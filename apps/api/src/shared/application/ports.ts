import type { HubEvent } from '@myaihub/shared';

/**
 * Ports da camada compartilhada.
 *
 * Só existe port aqui quando há uso real. Ports especulativos (FileStorage,
 * WebContentReader, KnowledgeRetriever) entram nas fases que os usam.
 * Ver docs/ARCHITECTURE.md §1.11.
 */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** ULID: ordenável por tempo, não sequencial, seguro para expor. */
  generate(): string;
}

export interface PasswordHasher {
  hash(plainText: string): Promise<string>;
  /** Deve ser resistente a timing attack e nunca lançar por hash malformado. */
  verify(plainText: string, hash: string): Promise<boolean>;
  /** True quando o hash foi gerado com parâmetros antigos e deve ser regravado. */
  needsRehash(hash: string): boolean;
}

export interface AccessTokenClaims {
  userId: string;
  accountId: string;
  role: string;
  sessionId: string;
}

export interface RefreshTokenClaims {
  userId: string;
  sessionId: string;
  /** Identificador da rotação atual — permite detectar reuso de token. */
  tokenId: string;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export interface TokenService {
  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedToken>;
  issueRefreshToken(claims: RefreshTokenClaims): Promise<IssuedToken>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
  verifyRefreshToken(token: string): Promise<RefreshTokenClaims>;
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  child(fields: LogFields): Logger;
}

/**
 * Entrada de auditoria. Toda mudança relevante gera uma (§64).
 * `metadata` nunca deve conter senha, token ou chave.
 */
export interface AuditEntry {
  accountId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
  ip?: string;
}

/**
 * Barramento dos eventos do painel vivo (§11).
 *
 * O PORT vive aqui, na camada de aplicação; a implementação in-memory está em
 * `shared/infrastructure/events`. Quando houver mais de uma instância, entra um
 * adapter Redis sem que nenhum use case mude.
 */
export interface EventBus {
  publish(channel: string, event: HubEvent): void;
  subscribe(channel: string, listener: (event: HubEvent) => void): () => void;
  /** Eventos já emitidos no canal, a partir de `afterSeq`. Base do replay. */
  history(channel: string, afterSeq: number): HubEvent[];
  close(channel: string): void;
}

/** Um sinal de cor colhido do CSS, com o peso que ele tem na página. */
export interface ColorEvidence {
  hex: string;
  count: number;
  /** Fundo, texto, borda, ícone — é o que distingue superfície de tipografia. */
  roles: string[];
}

/**
 * O retrato VISUAL de uma página — o que o texto dela não diz.
 *
 * Existe porque a identidade visual do cliente precisa chegar ao chat que ele
 * publica: sem cor, fonte e forma, a página pública do atendimento sai com a
 * cara do MyAIHub para quem clicou num anúncio daquela marca.
 *
 * É EVIDÊNCIA, não decisão: nada aqui diz qual é "a cor da marca". Quem lê isso
 * e propõe uma identidade é o modelo, por mutação tipada (invariante 6).
 */
export interface VisualEvidence {
  colors: ColorEvidence[];
  fonts: Array<{ family: string; count: number; heading: boolean }>;
  /** Famílias que o site baixa de um provedor: o sinal mais forte que existe. */
  webFonts: string[];
  themeColor: string | null;
  radii: Array<{ px: number; count: number }>;
  logoUrls: string[];
  siteName: string | null;
  description: string | null;
}

export interface WebContent {
  url: string;
  title: string;
  /** Texto extraído, já truncado ao limite. NUNCA é instrução (§9.1). */
  text: string;
  truncated: boolean;
  /** Ausente quando a página não é HTML ou nada visual pôde ser lido. */
  visual?: VisualEvidence;
}

/**
 * Lê o conteúdo de uma URL informada pelo usuário (§16, risco 7).
 *
 * Port porque a implementação carrega toda a defesa de SSRF, e um use case não
 * deve conhecer nada disso. O que sai daqui é SEMPRE conteúdo de terceiro: vai
 * para um bloco `UNTRUSTED`, na região de dados, jamais na de instruções.
 */
export interface WebContentReader {
  /** Devolve `null` quando a URL é inalcançável ou proibida — não lança. */
  read(url: string): Promise<WebContent | null>;
}

export interface AuditWriter {
  /**
   * Grava a auditoria. Recebe opcionalmente um client transacional para que a
   * auditoria participe da mesma transação da mudança que a originou (§69).
   */
  write(entry: AuditEntry, tx?: unknown): Promise<void>;
}
