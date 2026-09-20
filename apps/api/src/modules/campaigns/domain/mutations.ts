import { CAMPAIGN_FACET_MUTATION, ENFORCEMENT_LEVELS, type CampaignFacet } from '@myaihub/shared';
import { z } from 'zod';
import { llmRuleCheckSchema } from '../../myaihub/domain/llm-rule-check.js';

/**
 * Mutações canônicas da Campaign Strategy (§7.2).
 *
 * Uma por faceta, como no Agent Core: é `allowedMutations` que permite a
 * operação de CTA não conseguir reescrever o público-alvo, mesmo que o modelo
 * proponha. Uma mutação genérica destruiria essa fronteira.
 */

export const CAMPAIGN_MUTATION_KINDS = [
  'SET_CAMPAIGN_IDENTITY',
  'SET_CAMPAIGN_GOAL',
  'UPSERT_AUDIENCE_SEGMENT',
  'UPSERT_DISCOVERY_DIMENSION',
  'UPSERT_CAMPAIGN_STRATEGY',
  'UPSERT_CONVERSION_BEHAVIOR',
  'UPSERT_KNOWLEDGE_SCOPE',
  'UPSERT_CAMPAIGN_RULE',
  'SET_CAMPAIGN_CTA',
  'SET_CAMPAIGN_HERO_IMAGE',
  'REMOVE_CAMPAIGN_ITEM',
] as const;

export type CampaignMutationKind = (typeof CAMPAIGN_MUTATION_KINDS)[number];

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
};

export const campaignMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SET_CAMPAIGN_IDENTITY'),
    name: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().max(400).optional(),
  }),
  z.object({
    kind: z.literal('SET_CAMPAIGN_GOAL'),
    primary: z.string().trim().max(600).optional(),
    successCriteria: z.array(z.string().trim().max(300)).max(10).optional(),
  }),
  z.object({ kind: z.literal('UPSERT_AUDIENCE_SEGMENT'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_DISCOVERY_DIMENSION'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_CAMPAIGN_STRATEGY'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_CONVERSION_BEHAVIOR'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_KNOWLEDGE_SCOPE'), ...upsertFields }),
  z.object({ kind: z.literal('UPSERT_CAMPAIGN_RULE'), ...upsertFields }),
  z.object({
    kind: z.literal('SET_CAMPAIGN_CTA'),
    enabled: z.boolean().optional(),
    label: z.string().trim().max(80).optional(),
    url: z.string().trim().max(500).optional(),
    condition: z.string().trim().max(400).optional(),
  }),
  z.object({
    kind: z.literal('SET_CAMPAIGN_HERO_IMAGE'),
    /** Id de MediaAsset, ou `null` para remover a imagem do anúncio. */
    assetId: z.string().max(40).nullable(),
  }),
  z.object({
    kind: z.literal('REMOVE_CAMPAIGN_ITEM'),
    facet: z.enum([
      'audience',
      'discoveryDimensions',
      'strategy',
      'conversionBehavior',
      'knowledgeScope',
      'rules',
    ]),
    itemId: z.string().min(1).max(40),
    reason: z.string().trim().min(3).max(300),
  }),
]);

export type CampaignMutation = z.infer<typeof campaignMutationSchema>;

/** Faceta alvo de cada upsert — DERIVADA do contrato compartilhado. */
export const CAMPAIGN_MUTATION_FACET: Partial<Record<CampaignMutationKind, CampaignFacet>> =
  Object.fromEntries(
    Object.entries(CAMPAIGN_FACET_MUTATION).map(([facet, kind]) => [kind, facet]),
  ) as Partial<Record<CampaignMutationKind, CampaignFacet>>;
