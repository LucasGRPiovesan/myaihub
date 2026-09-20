import {
  conversationStatePatchSchema,
  type CanonicalAgent,
  type CanonicalCampaign,
  type ConversationStatePatch,
} from '@myaihub/shared';
import { z } from 'zod';
import type { Logger } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';

/**
 * Validação de aderência SEMÂNTICA (§6.2).
 *
 * Existe para as regras HARD que não são mecanicamente verificáveis. "Nunca
 * prometa prazo sem consultar a produção" não vira regex: um checker
 * determinístico ou passa por cima ou proíbe a palavra "prazo", e as duas
 * coisas são piores que não checar.
 *
 * A regra que decide se roda: só quando existe pelo menos uma HARD SEM `check`.
 * Regra que já tem checker foi verificada em código, e pagar um modelo para
 * reconferir o que a máquina provou é gastar duas vezes pelo mesmo não.
 *
 * O PATCH DE ESTADO viaja na MESMA resposta. É o padrão que o `plan` do painel
 * já usa: o campo pega carona numa chamada que está sendo paga de qualquer
 * jeito, então o estado da conversa custa zero token a mais. Uma chamada
 * separada por turno só para "ler sinais" dobraria o custo de cada atendimento
 * para produzir opinião — e opinião é justamente o que entra marcado como
 * DECLARED, valendo menos que o que o código observou.
 */

const adherenceSchema = z.object({
  /**
   * PRIMEIRO e curto, antes da lista.
   *
   * O modelo escreve o JSON na ordem do schema, e campo curto e decisório
   * depois de array longo é campo que ele chega ao fim sem escrever — foi assim
   * que `identity` e `objective` se perderam na criação de agente.
   */
  adherent: z.boolean(),
  violations: z
    .array(
      z.object({
        /** `code` do item violado, como aparece na regra. */
        itemCode: z.string().trim().max(20),
        evidence: z.string().trim().min(1).max(300),
      }),
    )
    .max(10)
    .default([]),
  /**
   * O estado é ACESSÓRIO e pode faltar inteiro.
   *
   * Um turno em que o modelo não leu nada de novo sobre a pessoa é normal, e
   * exigir o objeto faria a AUDITORIA — que é o motivo desta chamada — ser
   * recusada por causa da carona.
   */
  state: conversationStatePatchSchema.default({ facts: [], signals: [] }),
});

/**
 * A checagem ACONTECEU?
 *
 * Sem esta distinção, validador fora do ar e resposta impecável produziam o
 * mesmo resultado — lista de violações vazia — e a tela mostrava "regras
 * cumpridas" nos dois casos. Medido numa sessão de teste: três turnos exibiram
 * o selo verde enquanto o `validation.fast` morria com PROVIDER_UNAVAILABLE.
 *
 * O selo diz "verificada em código". Ele só pode aparecer quando alguém de fato
 * verificou.
 */
export type AdherenceStatus = 'CHECKED' | 'UNAVAILABLE';

export interface AdherenceResult {
  status: AdherenceStatus;
  violations: Array<{ check: string; message: string }>;
  statePatch: ConversationStatePatch | null;
}

/** Regras HARD sem checker — as únicas que este validador tem o que fazer com. */
export function semanticHardRules(
  agent: CanonicalAgent,
  campaign: CanonicalCampaign | undefined,
): Array<{ code: string; statement: string }> {
  const rules: Array<{ code: string; statement: string }> = [];

  for (const document of [agent, campaign]) {
    if (!document) continue;
    for (const value of Object.values(document)) {
      if (!Array.isArray(value)) continue;
      for (const item of value as Array<{
        code?: string;
        statement?: string;
        enforcement?: string;
        check?: unknown;
      }>) {
        if (item.enforcement !== 'HARD' || item.check || !item.statement) continue;
        rules.push({ code: item.code ?? '—', statement: item.statement });
      }
    }
  }

  return rules;
}

/**
 * Amostragem por campanha (§6.2).
 *
 * `on` no Lab, `sampled` em produção. O default é o que resolve o custo: um
 * atendimento longo pagaria uma validação por turno, e a taxa de violação não
 * muda o suficiente entre turnos para justificar isso.
 */
export type ValidationMode = 'on' | 'sampled' | 'off';

const SAMPLE_RATE = 0.25;

export function shouldValidate(mode: ValidationMode, random: number): boolean {
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return random < SAMPLE_RATE;
}

export class SemanticAdherenceValidator {
  constructor(
    private readonly deps: {
      gateway: LlmGateway;
      logger: Logger;
    },
  ) {}

  /**
   * `null` SÓ quando não havia regra semântica para checar.
   *
   * Falha NÃO derruba o turno: a resposta do agente já foi produzida e já foi
   * paga, e recusá-la porque um validador auxiliar não respondeu entregaria ao
   * visitante um erro no lugar de uma resposta que provavelmente estava boa.
   *
   * Mas ela também não pode desaparecer. Antes a falha devolvia `null`, igual a
   * "não havia o que checar", e quem chama somava `?? []` — então uma checagem
   * que nunca rodou virava, na tela, uma resposta aprovada. Agora a falha volta
   * como `UNAVAILABLE`: o turno segue, e quem exibe sabe que não sabe.
   */
  async validate(
    context: TenantContext,
    input: {
      rules: Array<{ code: string; statement: string }>;
      objective: string;
      transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
      reply: string;
    },
  ): Promise<AdherenceResult | null> {
    if (input.rules.length === 0) return null;

    const instruction = [
      'Você audita a última resposta de um agente de atendimento.',
      '',
      'REGRAS INEGOCIÁVEIS que ele tinha de cumprir:',
      ...input.rules.map((rule) => `- [${rule.code}] ${rule.statement}`),
      '',
      input.objective ? `OBJETIVO da conversa: ${input.objective}` : '',
      '',
      'Faça DUAS coisas:',
      '1. Diga se a resposta cumpriu TODAS as regras. Uma regra só é violada se a',
      '   resposta a contraria de fato — não marque violação por suspeita, por',
      '   assunto tocado, nem por algo que a regra não proíbe explicitamente.',
      '   Ao marcar, cite o TRECHO exato como evidência.',
      '2. Registre o que a PESSOA declarou sobre si (fatos), os sinais que ela deu,',
      '   e o quanto a conversa avançou rumo ao objetivo.',
      '',
      'Fato é o que ela DISSE, nunca o que você deduziu da profissão ou do jeito de',
      'falar dela. Sem declaração, não há fato.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await this.deps.gateway.generateStructured(
        context,
        {
          role: 'validation.fast',
          blocks: [
            {
              id: 'adherence.instruction',
              kind: 'POLICY',
              trust: 'TRUSTED',
              priority: 100,
              essential: true,
              cacheable: true,
              content: instruction,
            },
            {
              // A conversa é conteúdo de TERCEIRO: metade é fala de quem chegou
              // pelo anúncio, e é exatamente ali que caberia um "ignore as
              // regras anteriores" (§9.1).
              id: 'adherence.transcript',
              kind: 'UNTRUSTED',
              trust: 'UNTRUSTED',
              priority: 50,
              essential: true,
              cacheable: false,
              content: [
                ...input.transcript.map(
                  (turn) => `${turn.role === 'user' ? 'PESSOA' : 'AGENTE'}: ${turn.content}`,
                ),
                `RESPOSTA A AUDITAR: ${input.reply}`,
              ].join('\n'),
            },
          ],
          messages: [{ role: 'user', content: 'Audite e responda no formato pedido.' }],
          params: { temperature: 0 },
          tokenBudget: 8_000,
        },
        adherenceSchema,
      );

      const violations = result.content.violations.map((violation) => ({
        check: `semantic:${violation.itemCode}`,
        message: violation.evidence,
      }));

      return {
        status: 'CHECKED',
        violations: result.content.adherent ? [] : violations,
        statePatch: result.content.state,
      };
    } catch (error) {
      this.deps.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'validação de aderência falhou; o turno segue sem ela',
      );
      return { status: 'UNAVAILABLE', violations: [], statePatch: null };
    }
  }
}
