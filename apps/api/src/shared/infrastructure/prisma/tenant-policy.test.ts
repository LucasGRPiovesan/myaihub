import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { TENANT_MODEL_POLICY } from './tenant-policy.js';

/**
 * Este teste é o que mantém o guard honesto ao longo do tempo: adicionar um
 * modelo ao schema.prisma sem classificá-lo quebra o build, e não a produção.
 */
describe('tenant policy', () => {
  const models = Prisma.dmmf.datamodel.models.map((model) => model.name);

  it('classifica todos os modelos do schema', () => {
    const unclassified = models.filter((name) => !(name in TENANT_MODEL_POLICY));
    expect(
      unclassified,
      `Modelos sem classificação em tenant-policy.ts: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('não classifica modelos que não existem mais', () => {
    const stale = Object.keys(TENANT_MODEL_POLICY).filter((name) => !models.includes(name));
    expect(stale, `Classificações órfãs em tenant-policy.ts: ${stale.join(', ')}`).toEqual([]);
  });

  it('exige justificativa em todo modelo marcado como UNSCOPED', () => {
    const missingNote = Object.entries(TENANT_MODEL_POLICY)
      .filter(([, policy]) => policy.scope === 'UNSCOPED' && policy.note.trim() === '')
      .map(([name]) => name);

    expect(missingNote, `UNSCOPED sem justificativa: ${missingNote.join(', ')}`).toEqual([]);
  });

  it('garante que todo modelo TENANT_SCOPED realmente possui accountId', () => {
    const scoped = Object.entries(TENANT_MODEL_POLICY)
      .filter(([, policy]) => policy.scope === 'TENANT_SCOPED')
      .map(([name]) => name);

    const withoutColumn = scoped.filter((name) => {
      const model = Prisma.dmmf.datamodel.models.find((item) => item.name === name);
      return !model?.fields.some((field) => field.name === 'accountId');
    });

    expect(
      withoutColumn,
      `TENANT_SCOPED sem coluna accountId: ${withoutColumn.join(', ')}`,
    ).toEqual([]);
  });
});
