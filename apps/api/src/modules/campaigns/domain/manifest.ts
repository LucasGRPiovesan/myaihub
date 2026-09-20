import { createHash } from 'node:crypto';

/**
 * DeploymentManifest (§4.3).
 *
 * Congela QUAIS versões estavam valendo no ato da publicação. Alterar o Agent,
 * o Project ou a Campaign depois disso NÃO muda o que está no ar — republicar é
 * um ato deliberado.
 *
 * Por que congelar o provider aqui e não resolver em runtime: se o roteador de
 * modelos mudar amanhã, uma conversa pública em andamento passaria a responder
 * com outro modelo no meio do atendimento, sem ninguém ter pedido.
 */

/** O manifest como ele saiu na Fase 7, antes de existirem marca e conhecimento. */
export interface DeploymentManifestV1 {
  manifestVersion: 1;

  campaignId: string;
  campaignVersionId: string;
  agentId: string;
  agentVersionId: string;
  projectId: string;
  projectProfileVersionId: string | null;

  runtimeVersion: string;
  contextCompilerVersion: string;
  promptCompilerVersion: string;

  canonicalSchemaVersions: {
    agent: number;
    campaign: number;
    projectProfile: number | null;
  };

  providerConfig: {
    role: string;
    provider: string;
    model: string;
    generationParams: Record<string, unknown>;
  };

  ruleChecks: Array<{ name: string; params: unknown }>;
}

/**
 * v2: identidade de marca e conhecimento congelados (Fase 5).
 *
 * Sem estes dois campos a publicação era imutável só pela metade. O agente
 * podia dizer a mesma coisa de sempre enquanto a página trocava de cor porque
 * alguém editou a marca, e podia responder com um conhecimento que foi
 * reindexado hoje de manhã. "O que o público está vendo" precisa incluir o que
 * ele LÊ e o que o agente SABE, não só o que o agente é.
 */
export interface DeploymentManifestV2 extends Omit<DeploymentManifestV1, 'manifestVersion'> {
  manifestVersion: 2;

  brandIdentityVersionId: string | null;
  /** Conjunto congelado de fontes + revisões (§4.4). Nulo = projeto sem fontes. */
  knowledgeSnapshotId: string | null;

  canonicalSchemaVersions: {
    agent: number;
    campaign: number;
    projectProfile: number | null;
    brandIdentity: number | null;
  };
}

export type DeploymentManifest = DeploymentManifestV2;
export type AnyDeploymentManifest = DeploymentManifestV1 | DeploymentManifestV2;

export const CURRENT_MANIFEST_VERSION = 2 as const;

/**
 * Lê um manifest gravado, seja qual for a versão em que foi escrito.
 *
 * Mesma regra do canônico (§5.3): migra na LEITURA, nunca reescreve o
 * documento gravado. Um deployment é IMUTÁVEL — atualizá-lo para "arrumar" o
 * formato desfaria a única coisa que ele existe para garantir.
 *
 * Marca e conhecimento entram como nulos, e isso é a verdade sobre aquele
 * deployment: quando ele foi publicado, não havia nenhum dos dois para congelar.
 */
export function readManifest(stored: unknown): DeploymentManifestV2 {
  const manifest = stored as AnyDeploymentManifest;

  if (manifest.manifestVersion === 2) return manifest;

  return {
    ...manifest,
    manifestVersion: 2,
    brandIdentityVersionId: null,
    knowledgeSnapshotId: null,
    canonicalSchemaVersions: { ...manifest.canonicalSchemaVersions, brandIdentity: null },
  };
}

/**
 * Serialização canônica: chaves ordenadas, recursivamente.
 *
 * `JSON.stringify` preserva ordem de inserção, então dois manifests idênticos
 * montados em ordens diferentes produziriam hashes diferentes — e o hash
 * deixaria de ser identidade do conteúdo.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);

  return `{${entries.join(',')}}`;
}

export function hashManifest(manifest: AnyDeploymentManifest): string {
  return createHash('sha256').update(canonicalize(manifest)).digest('hex');
}
