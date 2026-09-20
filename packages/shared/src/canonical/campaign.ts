import { z } from 'zod';
import { canonicalItemSchema } from './item.js';
import type { CanonicalSchemaSet } from './migrate.js';

/**
 * Campaign Strategy canônica (§5.2).
 *
 * A campanha NÃO redefine o agente. Ela ESPECIALIZA a atuação dele num contexto:
 * o Philips continua sendo o Philips em todas as campanhas — o que muda é o que
 * ele persegue aqui, com quem fala e o que precisa descobrir antes de converter.
 *
 * Por isso não existe faceta de personalidade nem de comunicação: mexer nisso é
 * mexer no Agent Core, e o lugar disso é `agent.configure`. Duplicar as facetas
 * aqui criaria duas fontes de verdade para a mesma coisa.
 */

/** Prefixos de `code` por faceta. */
export const CAMPAIGN_FACET_CODES = {
  audience: 'AU',
  discoveryDimensions: 'DD',
  strategy: 'ES',
  conversionBehavior: 'CV',
  knowledgeScope: 'KS',
  rules: 'RG',
} as const;

export type CampaignFacet = keyof typeof CAMPAIGN_FACET_CODES;

export const CAMPAIGN_SEMANTIC_KEY_PREFIXES: Record<CampaignFacet, string> = {
  audience: 'audience',
  discoveryDimensions: 'discovery',
  strategy: 'strategy',
  conversionBehavior: 'conversion',
  knowledgeScope: 'knowledge',
  rules: 'rule',
};

export const CAMPAIGN_FACET_LABELS: Record<CampaignFacet, string> = {
  audience: 'Público',
  discoveryDimensions: 'O que descobrir',
  strategy: 'Estratégia',
  conversionBehavior: 'Comportamento de conversão',
  knowledgeScope: 'Escopo de conhecimento',
  rules: 'Regras da campanha',
};

/** Ver PROJECT_FACET_MUTATION: mesmo motivo, mesmo contrato. */
export const CAMPAIGN_FACET_MUTATION: Record<CampaignFacet, string> = {
  audience: 'UPSERT_AUDIENCE_SEGMENT',
  discoveryDimensions: 'UPSERT_DISCOVERY_DIMENSION',
  strategy: 'UPSERT_CAMPAIGN_STRATEGY',
  conversionBehavior: 'UPSERT_CONVERSION_BEHAVIOR',
  knowledgeScope: 'UPSERT_KNOWLEDGE_SCOPE',
  rules: 'UPSERT_CAMPAIGN_RULE',
};

export const CAMPAIGN_REMOVE_MUTATION = 'REMOVE_CAMPAIGN_ITEM';

/**
 * Chamada para ação.
 *
 * `condition` em linguagem natural é deliberado: é o agente que julga se a
 * conversa chegou lá. Uma condição estruturada ("depois de 3 mensagens") daria
 * uma falsa sensação de determinismo sobre algo que é julgamento.
 */
export const campaignCtaSchema = z.object({
  enabled: z.boolean().default(false),
  label: z.string().max(80).default(''),
  url: z.string().max(500).default(''),
  /** Quando o agente deve oferecer o CTA. Vazio = ao fim da descoberta. */
  condition: z.string().max(400).default(''),
});

export type CampaignCta = z.infer<typeof campaignCtaSchema>;

export const canonicalCampaignV1Schema = z.object({
  canonicalSchemaVersion: z.literal(1),

  identity: z.object({
    name: z.string().min(1).max(120),
    /** Uma linha sobre o que a campanha faz. */
    summary: z.string().max(400).default(''),
  }),

  goal: z.object({
    primary: z.string().max(600).default(''),
    /** O que caracteriza uma conversa bem-sucedida nesta campanha. */
    successCriteria: z.array(z.string().max(300)).max(10).default([]),
  }),

  audience: z.array(canonicalItemSchema).max(20).default([]),
  /** O que o agente precisa DESCOBRIR antes de propor. É o coração da campanha. */
  discoveryDimensions: z.array(canonicalItemSchema).max(20).default([]),
  strategy: z.array(canonicalItemSchema).max(20).default([]),
  conversionBehavior: z.array(canonicalItemSchema).max(20).default([]),
  knowledgeScope: z.array(canonicalItemSchema).max(20).default([]),
  rules: z.array(canonicalItemSchema).max(30).default([]),

  cta: campaignCtaSchema.default({ enabled: false, label: '', url: '', condition: '' }),

  /**
   * Id de MediaAsset (invariante 4). Vinculado automaticamente quando a
   * campanha nasce de uma mensagem com exatamente uma imagem anexada — não é
   * o modelo que decide isto, é o domínio (mesma classe do piso do playbook).
   * Editável depois pela mesma porta de mutação manual.
   */
  heroImageAssetId: z.string().max(40).nullable().default(null),
});

export type CanonicalCampaign = z.infer<typeof canonicalCampaignV1Schema>;

export const CAMPAIGN_SCHEMAS: CanonicalSchemaSet<CanonicalCampaign> = {
  latest: 1,
  schema: canonicalCampaignV1Schema,
  migrations: [],
};

export function emptyCampaign(name: string): CanonicalCampaign {
  return {
    canonicalSchemaVersion: 1,
    identity: { name, summary: '' },
    goal: { primary: '', successCriteria: [] },
    audience: [],
    discoveryDimensions: [],
    strategy: [],
    conversionBehavior: [],
    knowledgeScope: [],
    rules: [],
    cta: { enabled: false, label: '', url: '', condition: '' },
    heroImageAssetId: null,
  };
}

/** Projeção humana do canônico. Derivada, nunca armazenada em paralelo. */
export function summarizeCampaign(campaign: CanonicalCampaign): string[] {
  const lines: string[] = [];
  if (campaign.identity.summary) {
    lines.push(`${campaign.identity.name} — ${campaign.identity.summary}`);
  }
  if (campaign.goal.primary) lines.push(`Objetivo: ${campaign.goal.primary}`);

  for (const criterion of campaign.goal.successCriteria) {
    lines.push(`Sucesso: ${criterion}`);
  }

  for (const facet of Object.keys(CAMPAIGN_FACET_CODES) as CampaignFacet[]) {
    for (const item of campaign[facet]) {
      lines.push(`${item.code} · ${item.label}: ${item.statement}`);
    }
  }

  if (campaign.cta.enabled && campaign.cta.label) {
    lines.push(`CTA: ${campaign.cta.label} → ${campaign.cta.url}`);
  }

  return lines;
}

export function countCampaignItems(campaign: CanonicalCampaign): number {
  return (Object.keys(CAMPAIGN_FACET_CODES) as CampaignFacet[]).reduce(
    (total, facet) => total + campaign[facet].length,
    0,
  );
}

/**
 * O que falta para a campanha poder ir ao ar.
 *
 * Publicar congela um manifest imutável (§4.3). Deixar publicar uma campanha sem
 * objetivo ou sem nada a descobrir congelaria um agente que não sabe o que
 * perguntar — e só se descobre isso com o chat no ar.
 */
export function campaignPublishBlockers(campaign: CanonicalCampaign): string[] {
  const blockers: string[] = [];

  if (!campaign.goal.primary.trim()) {
    blockers.push('A campanha ainda não tem objetivo definido.');
  }
  if (campaign.discoveryDimensions.length === 0) {
    blockers.push('A campanha não define o que o agente precisa descobrir na conversa.');
  }
  if (campaign.cta.enabled && !campaign.cta.url.trim()) {
    blockers.push('O CTA está ativo mas sem link de destino.');
  }

  return blockers;
}
