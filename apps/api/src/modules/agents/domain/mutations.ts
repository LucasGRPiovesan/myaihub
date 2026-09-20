import { AGENT_FACET_MUTATION, ENFORCEMENT_LEVELS, type AgentFacet } from '@myaihub/shared';
import { z } from 'zod';
import { llmRuleCheckSchema } from '../../myaihub/domain/llm-rule-check.js';

/**
 * Mutações canônicas do Agent Core (§7.2).
 *
 * Uma por faceta, de propósito: é `allowedMutations` que permite uma operação
 * de comunicação NÃO poder alterar limites, mesmo que o modelo proponha. Uma
 * mutação genérica "UPSERT_ITEM(facet)" destruiria essa fronteira.
 */

export const AGENT_MUTATION_KINDS = [
  'SET_AGENT_IDENTITY',
  'SET_AGENT_OBJECTIVE',
  'SET_AGENT_ENGAGEMENT',
  'UPSERT_PERSONALITY_TRAIT',
  'UPSERT_COMMUNICATION_TRAIT',
  'UPSERT_SKILL',
  'UPSERT_BEHAVIOR',
  'UPSERT_STRATEGY',
  'UPSERT_HARD_RULE',
  'UPSERT_LIMIT',
  'REMOVE_AGENT_ITEM',
] as const;

export type AgentMutationKind = (typeof AGENT_MUTATION_KINDS)[number];

const upsertFields = {
  semanticKey: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/),
  label: z.string().trim().min(1).max(80),
  statement: z.string().trim().min(1).max(1200),
  enforcement: z.enum(ENFORCEMENT_LEVELS).default('SOFT'),
  check: llmRuleCheckSchema.optional(),
  /**
   * O usuário pediu isto, ou o OS inferiu do papel?
   *
   * Ausente = inferido, porque na criação a maior parte da configuração vem de
   * ofício, não de fala. O modelo marca `USER_DIRECTED` só no que ele de fato
   * disse — é o que permite reconciliar depois sem apagar a intenção dele.
   */
  origin: z.enum(['USER_DIRECTED', 'INFERRED_BASELINE']).optional(),
  /** Por que o OS inferiu este item. Obrigatório na prática para baseline. */
  rationale: z.string().trim().max(300).optional(),
};

export const agentMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SET_AGENT_IDENTITY'),
    name: z.string().trim().min(1).max(80).optional(),
    role: z.string().trim().max(160).optional(),
    archetype: z.string().trim().max(80).optional(),
  }),
  z.object({
    kind: z.literal('SET_AGENT_OBJECTIVE'),
    primary: z.string().trim().max(600).optional(),
    secondary: z.array(z.string().trim().max(300)).max(10).optional(),
  }),
  z.object({
    kind: z.literal('SET_AGENT_ENGAGEMENT'),
    initiator: z.enum(['USER', 'AGENT']).optional(),
    /**
     * `SCRIPTED` só quando o usuário QUER a mesma frase toda vez. Um exemplo
     * que ele deu para ilustrar o tom não é pedido de roteiro.
     */
    openerMode: z.enum(['ADAPTIVE', 'SCRIPTED']).optional(),
    opener: z.string().trim().max(600).optional(),
    openerGuidance: z.string().trim().max(800).optional(),
    suggestedRepliesEnabled: z.boolean().optional(),
    visualBlocksEnabled: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('UPSERT_PERSONALITY_TRAIT'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_COMMUNICATION_TRAIT'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_SKILL'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_BEHAVIOR'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_STRATEGY'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_HARD_RULE'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_LIMIT'), ...upsertFields }),
  z.object({
    kind: z.literal('REMOVE_AGENT_ITEM'),
    facet: z.enum([
      'personality',
      'communication',
      'skills',
      'behaviors',
      'strategies',
      'hardRules',
      'limits',
    ]),
    itemId: z.string().min(1).max(40),
    reason: z.string().trim().min(3).max(300),
  }),
]);

export type AgentMutation = z.infer<typeof agentMutationSchema>;

/**
 * Faceta alvo de cada upsert — DERIVADA do contrato compartilhado.
 *
 * Manter os dois mapas à mão faria o painel montar `UPSERT_SKILL` enquanto o
 * domínio esperava outro nome, e a falha apareceria só em runtime.
 */
export const AGENT_MUTATION_FACET: Partial<Record<AgentMutationKind, AgentFacet>> =
  Object.fromEntries(
    Object.entries(AGENT_FACET_MUTATION).map(([facet, kind]) => [kind, facet]),
  ) as Partial<Record<AgentMutationKind, AgentFacet>>;

/** Mutações que alteram itens de faceta — as que podem carregar `check`. */
export const AGENT_UPSERT_KINDS = Object.keys(AGENT_MUTATION_FACET) as AgentMutationKind[];

/**
 * O array de mutações, tolerante a `kind` inventado.
 *
 * O `kind` é o discriminador: um valor fora do vocabulário não falha UM item,
 * falha o `safeParse` inteiro — e a saída de uma criação de agente tem trinta
 * itens bons dentro. Medido em produção: duas criações seguidas recusadas por
 * `mutations.1.kind` e `mutations.12.kind`, cada uma pagando um turno de
 * correção de dois minutos, para no fim entregar erro ao usuário.
 *
 * É a mesma regra que já vale para `type`, para o nome de checker e para o
 * prefixo de `semanticKey`: campo que o modelo erra na FORMA não descarta o
 * conteúdo. A diferença é que aqui não dá para corrigir — sem saber qual
 * mutação ele queria, adivinhar seria pior. Então o item é descartado, e só
 * ele.
 *
 * A validação NÃO afrouxa: o que sobra passa pela união discriminada inteira,
 * com os mesmos campos obrigatórios de sempre. O que se perde é um item entre
 * muitos; o que se ganha é a operação não morrer por causa dele.
 */
const KNOWN_MUTATION_KINDS = new Set<string>(
  agentMutationSchema.options.map((option) => option.shape.kind.value as string),
);

export const agentMutationsSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  return value.filter(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      KNOWN_MUTATION_KINDS.has((item as { kind?: unknown }).kind as string),
  );
}, z.array(agentMutationSchema).max(40));
