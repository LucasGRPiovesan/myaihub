import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  CURRENT_MANIFEST_VERSION,
  hashManifest,
  readManifest,
  type DeploymentManifestV1,
} from './manifest.js';

const V1: DeploymentManifestV1 = {
  manifestVersion: 1,
  campaignId: '01JCAMPAIGNXXXXXXXXXXXXXXX',
  campaignVersionId: '01JCVERSIONXXXXXXXXXXXXXXX',
  agentId: '01JAGENTXXXXXXXXXXXXXXXXXX',
  agentVersionId: '01JAVERSIONXXXXXXXXXXXXXXX',
  projectId: '01JPROJECTXXXXXXXXXXXXXXXX',
  projectProfileVersionId: '01JPVERSIONXXXXXXXXXXXXXXX',
  runtimeVersion: '1.0.0',
  contextCompilerVersion: '1.0.0',
  promptCompilerVersion: '1.0.0',
  canonicalSchemaVersions: { agent: 1, campaign: 1, projectProfile: 2 },
  providerConfig: {
    role: 'agent.runtime',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    generationParams: { temperature: 0.6 },
  },
  ruleChecks: [],
};

describe('leitura de manifest gravado', () => {
  it('um deployment da Fase 7 continua legível, com marca e conhecimento nulos', () => {
    const lido = readManifest(V1);

    expect(lido.manifestVersion).toBe(2);
    // Nulo é a VERDADE sobre aquele deployment: quando ele foi publicado, não
    // havia marca nem snapshot para congelar.
    expect(lido.brandIdentityVersionId).toBeNull();
    expect(lido.knowledgeSnapshotId).toBeNull();
    expect(lido.canonicalSchemaVersions.brandIdentity).toBeNull();
  });

  it('preserva tudo o que a v1 já congelava', () => {
    const lido = readManifest(V1);

    expect(lido.agentVersionId).toBe(V1.agentVersionId);
    expect(lido.campaignVersionId).toBe(V1.campaignVersionId);
    expect(lido.projectProfileVersionId).toBe(V1.projectProfileVersionId);
    expect(lido.providerConfig).toEqual(V1.providerConfig);
  });

  it('um manifest v2 passa intacto', () => {
    const v2 = {
      ...V1,
      manifestVersion: CURRENT_MANIFEST_VERSION,
      brandIdentityVersionId: '01JBRANDXXXXXXXXXXXXXXXXXX',
      knowledgeSnapshotId: '01JSNAPSHOTXXXXXXXXXXXXXXX',
      canonicalSchemaVersions: { ...V1.canonicalSchemaVersions, brandIdentity: 1 },
    } as const;

    expect(readManifest(v2)).toEqual(v2);
  });
});

describe('hash do manifest', () => {
  it('não depende da ordem em que as chaves foram montadas', () => {
    const a = { manifestVersion: 1, campaignId: 'x', agentId: 'y' };
    const b = { agentId: 'y', campaignId: 'x', manifestVersion: 1 };

    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('muda quando o conteúdo muda — é o que faz o hash ser identidade', () => {
    const outro = { ...V1, agentVersionId: '01JOUTRAVERSAOXXXXXXXXXXXX' };

    expect(hashManifest(V1)).not.toBe(hashManifest(outro));
  });

  it('a MIGRAÇÃO NA LEITURA muda o hash — por isso o gravado nunca é reescrito', () => {
    // Se um dia alguém "arrumar o formato" de um deployment gravado, o hash
    // deixa de bater com o que foi publicado. Este teste existe para que essa
    // tentação apareça como falha, e não como surpresa em produção.
    expect(hashManifest(readManifest(V1))).not.toBe(hashManifest(V1));
  });
});
