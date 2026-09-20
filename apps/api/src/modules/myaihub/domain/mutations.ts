import { z } from 'zod';
import { ENFORCEMENT_LEVELS, PROJECT_FACET_MUTATION } from '@myaihub/shared';
import { llmRuleCheckSchema } from './llm-rule-check.js';

/**
 * Mutações canônicas tipadas (§7.2).
 *
 * A LLM PROPÕE; o domínio valida e aplica. Não existe JSON Patch livre: um
 * modelo capaz de escrever qualquer caminho do documento é um modelo capaz de
 * reescrever regras de negócio que ninguém pediu.
 *
 * Cada operação declara em `allowedMutations` o que pode produzir. Mutação fora
 * desse escopo é REJEITADA e registrada — não aplicada "por precaução".
 */

export const CANONICAL_MUTATION_KINDS = [
  'SET_PROJECT_IDENTITY',
  'UPSERT_AUDIENCE',
  'UPSERT_OFFERING',
  'UPSERT_VALUE_PROPOSITION',
  'UPSERT_DIFFERENTIATOR',
  'UPSERT_MARKET_INSIGHT',
  'UPSERT_BUSINESS_RULE',
  'REMOVE_ITEM',
] as const;

export type CanonicalMutationKind = (typeof CANONICAL_MUTATION_KINDS)[number];

/** Campos comuns a todo upsert de item. */
const upsertItemFields = {
  semanticKey: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/),
  label: z.string().trim().min(1).max(80),
  statement: z.string().trim().min(1).max(1200),
  enforcement: z.enum(ENFORCEMENT_LEVELS).default('SOFT'),
  check: llmRuleCheckSchema.optional(),
};

export const canonicalMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SET_PROJECT_IDENTITY'),
    name: z.string().trim().min(1).max(120).optional(),
    type: z.string().trim().max(40).optional(),
    summary: z.string().trim().max(2000).optional(),
    businessModel: z.string().trim().max(200).optional(),
    businessStage: z.string().trim().max(120).optional(),
  }),
  z.object({ kind: z.literal('UPSERT_AUDIENCE'), ...upsertItemFields }),
  z.object({ kind: z.literal('UPSERT_OFFERING'), ...upsertItemFields }),
  z.object({ kind: z.literal('UPSERT_VALUE_PROPOSITION'), ...upsertItemFields }),
  z.object({ kind: z.literal('UPSERT_DIFFERENTIATOR'), ...upsertItemFields }),
  z.object({ kind: z.literal('UPSERT_MARKET_INSIGHT'), ...upsertItemFields }),
  // A única faceta do perfil cujo `enforcement` tem consequência de runtime:
  // marcada HARD, a regra sobe para as REGRAS INEGOCIÁVEIS do prompt de TODO
  // agente que atua neste projeto. É por isso que ela é mutação própria e não
  // mais um item solto dentro de `differentiators`.
  z.object({ kind: z.literal('UPSERT_BUSINESS_RULE'), ...upsertItemFields }),
  z.object({
    kind: z.literal('REMOVE_ITEM'),
    facet: z.enum([
      'audiences',
      'offerings',
      'valuePropositions',
      'differentiators',
      'market',
      'businessRules',
    ]),
    itemId: z.string().min(1).max(40),
    /** Obrigatório: remoção sem motivo é indistinguível de alucinação. */
    reason: z.string().trim().min(3).max(300),
  }),
]);

export type CanonicalMutation = z.infer<typeof canonicalMutationSchema>;

/** Faceta alvo de cada upsert. */
/** DERIVADO do contrato compartilhado — ver AGENT_MUTATION_FACET. */
export const MUTATION_TARGET_FACET: Partial<Record<CanonicalMutationKind, string>> =
  Object.fromEntries(
    Object.entries(PROJECT_FACET_MUTATION).map(([facet, kind]) => [kind, facet]),
  ) as Partial<Record<CanonicalMutationKind, string>>;
