import type { TenantContext } from '../../../shared/application/tenant-context.js';

/**
 * O ENSAIO: o S.O roda o agente que ele acabou de configurar, antes de dizer
 * que está pronto.
 *
 * Porta, e não chamada direta, pela regra de camadas de sempre — mas também
 * porque a dependência é invertida de propósito: quem sabe COMPILAR e RODAR um
 * agente é o módulo de agentes; quem sabe se a correção precisava ser conferida
 * é o S.O. O runner pede o ensaio e lê o veredito, sem saber como o agente é
 * executado.
 */
export interface AgentRehearsal {
  rehearse(context: TenantContext, input: RehearsalInput): Promise<RehearsalOutcome>;
}

export interface RehearsalInput {
  agentId: string;
  /** A conversa de teste que motivou a queixa. */
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** O que o usuário reclamou, nas palavras dele. */
  complaint: string;
  /** As regras que este turno escreveu ou ajustou. É o que o juiz cobra. */
  rules: Array<{ code: string; statement: string }>;
}

export type RehearsalOutcome =
  | {
      status: 'PASSED' | 'FAILED';
      /** A resposta que o agente deu no ensaio. */
      reply: string;
      /** O trecho que ainda falha, quando falha. */
      evidence: string;
      costMicros: number;
      totalTokens: number;
    }
  | {
      /** Não havia o que ensaiar — e isso não é falha do agente. */
      status: 'SKIPPED';
      reason: string;
      costMicros: number;
      totalTokens: number;
    };
