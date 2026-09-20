import {
  assertEnforcementCoherent,
  buildCode,
  CAMPAIGN_FACET_CODES,
  CAMPAIGN_SEMANTIC_KEY_PREFIXES,
  canonicalCampaignV1Schema,
  renumberCodes,
  type CampaignFacet,
  type CanonicalCampaign,
  type CanonicalItem,
} from '@myaihub/shared';
import { AppError } from '../../../shared/domain/errors.js';
import {
  reconcileCheck,
  type ApplyMutationsResult,
  type MutationContext,
  type MutationRejection,
} from '../../myaihub/domain/mutation-applier.js';
import {
  CAMPAIGN_MUTATION_FACET,
  type CampaignMutation,
  type CampaignMutationKind,
} from './mutations.js';

export type ApplyCampaignMutationsResult = ApplyMutationsResult<
  CanonicalCampaign,
  CampaignMutation
>;

/**
 * Aplica mutações à Campaign Strategy canônica.
 *
 * Mesmo contrato do Agent Core: upsert por `semanticKey` FUNDE no item existente
 * preservando o id técnico, e erro de FORMA (prefixo errado, checker inventado)
 * corrige em vez de descartar — o conteúdo é o que o usuário disse.
 */
export class CampaignMutationApplier {
  apply(
    current: CanonicalCampaign,
    mutations: CampaignMutation[],
    context: MutationContext<CampaignMutationKind>,
  ): ApplyCampaignMutationsResult {
    let campaign: CanonicalCampaign = structuredClone(current);
    const applied: CampaignMutation[] = [];
    const rejected: MutationRejection[] = [];
    const adjustments: string[] = [];

    for (const mutation of mutations) {
      if (!context.allowedMutations.includes(mutation.kind)) {
        rejected.push({
          kind: mutation.kind,
          reason: `Mutação fora do escopo desta operação (permitidas: ${context.allowedMutations.join(', ')}).`,
        });
        continue;
      }

      try {
        campaign = this.applyOne(campaign, mutation, context, adjustments);
        applied.push(mutation);
      } catch (error) {
        rejected.push({
          kind: mutation.kind,
          reason: error instanceof Error ? error.message : 'Falha ao aplicar mutação.',
        });
      }
    }

    const parsed = canonicalCampaignV1Schema.safeParse(campaign);
    if (!parsed.success) {
      throw new AppError(
        'CANONICAL_SCHEMA_INVALID',
        'A configuração resultante não é uma estratégia de campanha válida.',
        {
          httpStatus: 422,
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      );
    }

    return { canonical: parsed.data, applied, rejected, adjustments };
  }

  private applyOne(
    campaign: CanonicalCampaign,
    mutation: CampaignMutation,
    context: MutationContext<CampaignMutationKind>,
    adjustments: string[],
  ): CanonicalCampaign {
    if (mutation.kind === 'SET_CAMPAIGN_IDENTITY') {
      return {
        ...campaign,
        identity: {
          ...campaign.identity,
          ...(mutation.name !== undefined ? { name: mutation.name } : {}),
          ...(mutation.summary !== undefined ? { summary: mutation.summary } : {}),
        },
      };
    }

    if (mutation.kind === 'SET_CAMPAIGN_GOAL') {
      return {
        ...campaign,
        goal: {
          ...campaign.goal,
          ...(mutation.primary !== undefined ? { primary: mutation.primary } : {}),
          ...(mutation.successCriteria !== undefined
            ? { successCriteria: mutation.successCriteria }
            : {}),
        },
      };
    }

    if (mutation.kind === 'SET_CAMPAIGN_CTA') {
      const cta = {
        ...campaign.cta,
        ...(mutation.enabled !== undefined ? { enabled: mutation.enabled } : {}),
        ...(mutation.label !== undefined ? { label: mutation.label } : {}),
        ...(mutation.url !== undefined ? { url: mutation.url } : {}),
        ...(mutation.condition !== undefined ? { condition: mutation.condition } : {}),
      };

      if (cta.enabled && !cta.url.trim()) {
        // CTA ligado sem destino é um botão que não leva a lugar nenhum — o
        // usuário só descobriria com o chat no ar.
        throw new Error('Um CTA ativo precisa de um link de destino.');
      }

      return { ...campaign, cta };
    }

    if (mutation.kind === 'SET_CAMPAIGN_HERO_IMAGE') {
      return { ...campaign, heroImageAssetId: mutation.assetId };
    }

    if (mutation.kind === 'REMOVE_CAMPAIGN_ITEM') {
      const facet = mutation.facet as CampaignFacet;
      const items = campaign[facet];
      const target = items.find((item) => item.id === mutation.itemId);

      if (!target) {
        throw new Error(`Item "${mutation.itemId}" não existe em "${facet}".`);
      }
      if (target.source === 'USER' && context.source !== 'USER') {
        throw new Error(
          `O item "${target.code}" foi definido pelo usuário; remoção exige pedido explícito.`,
        );
      }

      return {
        ...campaign,
        [facet]: renumberCodes(
          CAMPAIGN_FACET_CODES[facet],
          items.filter((item) => item.id !== mutation.itemId),
        ),
      };
    }

    const facet = CAMPAIGN_MUTATION_FACET[mutation.kind];
    if (!facet) throw new Error(`Mutação "${mutation.kind}" sem faceta alvo.`);

    return this.upsert(campaign, facet, mutation, context, adjustments);
  }

  private upsert(
    campaign: CanonicalCampaign,
    facet: CampaignFacet,
    mutation: Extract<CampaignMutation, { semanticKey: string }>,
    context: MutationContext<CampaignMutationKind>,
    adjustments: string[],
  ): CanonicalCampaign {
    const expectedPrefix = CAMPAIGN_SEMANTIC_KEY_PREFIXES[facet];
    let semanticKey = mutation.semanticKey;

    if (!semanticKey.startsWith(`${expectedPrefix}.`)) {
      // Prefixo errado é erro de forma, não de conteúdo (ver CLAUDE.md).
      const suffix = semanticKey.includes('.')
        ? semanticKey.split('.').slice(1).join('.')
        : semanticKey;
      semanticKey = `${expectedPrefix}.${suffix}`;
      adjustments.push(
        `A chave "${mutation.semanticKey}" não pertence a "${facet}"; corrigi para "${semanticKey}".`,
      );
    }

    const enforced = reconcileCheck(context, mutation, mutation.label, adjustments);

    const items = [...campaign[facet]];
    const timestamp = context.now.toISOString();
    const existingIndex = items.findIndex((item) => item.semanticKey === semanticKey);

    const base = {
      semanticKey,
      label: mutation.label,
      statement: mutation.statement,
      enforcement: enforced.enforcement,
      ...(enforced.check ? { check: enforced.check } : {}),
      updatedAt: timestamp,
    };

    if (existingIndex >= 0) {
      const existing = items[existingIndex]!;
      // Preserva o id técnico: o item é o MESMO, refinado (§5.1).
      const merged: CanonicalItem = { ...existing, ...base, source: existing.source };
      if (!enforced.check) delete merged.check;
      assertEnforcementCoherent(merged);
      items[existingIndex] = merged;
    } else {
      const created: CanonicalItem = {
        id: context.nextId(),
        code: buildCode(CAMPAIGN_FACET_CODES[facet], items.length + 1),
        ...base,
        source: context.source,
        ...(context.originHubMessageId ? { originHubMessageId: context.originHubMessageId } : {}),
        createdAt: timestamp,
      };
      assertEnforcementCoherent(created);
      items.push(created);
    }

    return { ...campaign, [facet]: renumberCodes(CAMPAIGN_FACET_CODES[facet], items) };
  }
}
