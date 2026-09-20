import { emptyCampaign } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import type { MutationContext } from '../../myaihub/domain/mutation-applier.js';
import { CampaignMutationApplier } from './mutation-applier.js';
import type { CampaignMutationKind } from './mutations.js';

const applier = new CampaignMutationApplier();

function contexto(
  allowedMutations: readonly CampaignMutationKind[] = ['SET_CAMPAIGN_HERO_IMAGE'],
): MutationContext<CampaignMutationKind> {
  return {
    allowedMutations,
    now: new Date('2026-09-16T00:00:00Z'),
    nextId: () => '01JCAMPAIGNTESTIDXXXXXXXXX',
    source: 'USER',
    validateCheck: () => ({ ok: false, reason: 'Esta campanha não tem checkers.' }),
  };
}

describe('mutação de imagem-herói da campanha', () => {
  it('grava o assetId', () => {
    const { canonical, applied } = applier.apply(
      emptyCampaign('Divulgação Institucional'),
      [{ kind: 'SET_CAMPAIGN_HERO_IMAGE', assetId: '01JMEDIAASSETIDXXXXXXXXXX' }],
      contexto(),
    );

    expect(canonical.heroImageAssetId).toBe('01JMEDIAASSETIDXXXXXXXXXX');
    expect(applied).toHaveLength(1);
  });

  it('remove a imagem com assetId nulo', () => {
    const comImagem = {
      ...emptyCampaign('Divulgação Institucional'),
      heroImageAssetId: '01JMEDIAASSETIDXXXXXXXXXX',
    };

    const { canonical } = applier.apply(
      comImagem,
      [{ kind: 'SET_CAMPAIGN_HERO_IMAGE', assetId: null }],
      contexto(),
    );

    expect(canonical.heroImageAssetId).toBeNull();
  });

  it('não mexe em outras facetas (merge, não substituição)', () => {
    const atual = {
      ...emptyCampaign('Divulgação Institucional'),
      goal: { primary: 'Gerar leads qualificados', successCriteria: [] },
    };

    const { canonical } = applier.apply(
      atual,
      [{ kind: 'SET_CAMPAIGN_HERO_IMAGE', assetId: '01JMEDIAASSETIDXXXXXXXXXX' }],
      contexto(),
    );

    expect(canonical.goal.primary).toBe('Gerar leads qualificados');
  });

  it('recusa a mutação fora do escopo permitido pela operação', () => {
    const { applied, rejected } = applier.apply(
      emptyCampaign('Divulgação Institucional'),
      [{ kind: 'SET_CAMPAIGN_HERO_IMAGE', assetId: '01JMEDIAASSETIDXXXXXXXXXX' }],
      contexto(['SET_CAMPAIGN_CTA']),
    );

    expect(applied).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/fora do escopo/);
  });
});
