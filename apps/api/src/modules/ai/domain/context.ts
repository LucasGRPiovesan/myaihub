import { createHash } from 'node:crypto';

/**
 * Blocos de contexto (§9 da arquitetura).
 *
 * O Context Compiler produz uma lista ordenada destes; o Prompt Compiler os
 * projeta em um request de provider. A separação existe para que a decisão
 * "o que entra no contexto" seja testável sem tocar em nenhum SDK.
 */

export const CONTEXT_BLOCK_KINDS = [
  /** Master Policy do MyAIHub OS. */
  'POLICY',
  /** Agent Core, Project Profile, Campaign Strategy — prefixo cacheável. */
  'STABLE',
  /** Session State, últimos turnos — sufixo. */
  'DYNAMIC',
  /** Conhecimento recuperado. */
  'KNOWLEDGE',
  /** Conteúdo de terceiros: site raspado, input do público. NUNCA é instrução. */
  'UNTRUSTED',
] as const;

export type ContextBlockKind = (typeof CONTEXT_BLOCK_KINDS)[number];

export type TrustLevel = 'TRUSTED' | 'UNTRUSTED';

export interface ContextBlock {
  id: string;
  kind: ContextBlockKind;
  trust: TrustLevel;
  /** Prioridade de retenção quando o orçamento estoura. Maior = mantém primeiro. */
  priority: number;
  cacheable: boolean;
  content: string;
  /** Versão da entidade que originou o bloco, quando houver. */
  sourceVersionId?: string;
  /**
   * Bloco sem o qual a operação não faz sentido. NUNCA é cortado.
   *
   * A `priority` sozinha não dava conta, porque ela responde duas perguntas
   * diferentes com o mesmo número: em que ORDEM o bloco aparece e quem SAI
   * quando falta espaço. O contrato de saída precisa das duas pontas opostas —
   * última posição (prioridade mínima) e proteção máxima — e com um número só
   * ele era, por construção, o primeiro a ser descartado.
   *
   * Visto em produção: numa operação de ajuste caíram `operation.output_contract`
   * e `agent.core` — ou seja, o OS reconfigurou um agente SEM VER o agente e
   * SEM o contrato que diz o formato da resposta. Nada acusou: o corte é
   * silencioso e a operação termina "com sucesso".
   */
  essential?: boolean;
}

export interface DroppedBlock {
  id: string;
  kind: ContextBlockKind;
  tokensEstimate: number;
  reason: 'TOKEN_BUDGET';
}

export interface CompiledBlock extends ContextBlock {
  tokensEstimate: number;
  contentHash: string;
}

export interface ContextPackage {
  blocks: CompiledBlock[];
  /** O que foi cortado por orçamento. Vai para o ExecutionTrace, não some. */
  dropped: DroppedBlock[];
  tokenBudget: number;
  tokensEstimate: number;
}

/**
 * `UNTRUSTED` implica sempre trust UNTRUSTED — a marcação não pode divergir do
 * tipo, senão a segregação do §9.1 vira sorte.
 */
export function trustForKind(kind: ContextBlockKind): TrustLevel {
  return kind === 'UNTRUSTED' ? 'UNTRUSTED' : 'TRUSTED';
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Estimativa de tokens sem tokenizer.
 *
 * Deliberadamente aproximada e pessimista: serve para ORÇAMENTO, não para
 * cobrança. O número real vem do provider, em `NormalizedUsage`. Um tokenizer
 * por provider entraria aqui atrás do mesmo port, se algum dia o corte por
 * orçamento precisar de precisão.
 */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  // ~4 caracteres por token para texto latino; arredonda para cima.
  return Math.ceil(content.length / 4);
}
