import type { KnowledgeSourceKind, KnowledgeSourceStatus } from '@myaihub/shared';
import type { TenantContext } from '../../../shared/application/tenant-context.js';

export interface KnowledgeSourceRecord {
  id: string;
  projectId: string;
  kind: KnowledgeSourceKind;
  status: KnowledgeSourceStatus;
  title: string;
  uri: string | null;
  currentRevisionId: string | null;
  revisionNumber: number | null;
  contentLength: number;
  lastError: string | null;
  extractedAt: Date | null;
  createdAt: Date;
}

export interface KnowledgeRevisionRecord {
  id: string;
  sourceId: string;
  revisionNumber: number;
  contentHash: string;
  extractedContent: string;
  contentLength: number;
  extractedAt: Date;
}

export interface CreateKnowledgeSourceInput {
  id: string;
  projectId: string;
  kind: KnowledgeSourceKind;
  title: string;
  uri: string | null;
  createdBy: string;
}

export interface SaveRevisionInput {
  sourceId: string;
  revision: {
    id: string;
    contentHash: string;
    extractedContent: string;
  };
}

/** Uma fonte, na revisão em que ela foi congelada. É o que o runtime lê. */
export interface SnapshotEntry {
  sourceId: string;
  revisionId: string;
  title: string;
  uri: string | null;
  extractedContent: string;
}

/**
 * Conhecimento do negócio (§4.4, Fase 5).
 *
 * A revisão é IMUTÁVEL e o snapshot congela um conjunto delas. É o que faz a
 * publicação continuar reproduzível quando o site do cliente muda no dia
 * seguinte: o deployment de ontem segue lendo o que existia ontem.
 */
export interface KnowledgeRepository {
  createSource(
    context: TenantContext,
    input: CreateKnowledgeSourceInput,
  ): Promise<KnowledgeSourceRecord>;

  /**
   * Grava uma revisão nova e move o ponteiro.
   *
   * `null` quando o conteúdo não mudou: reindexar uma página idêntica não pode
   * criar revisão, senão todo snapshot passaria a apontar para um id novo que
   * descreve exatamente o mesmo texto.
   */
  saveRevision(
    context: TenantContext,
    input: SaveRevisionInput,
  ): Promise<KnowledgeRevisionRecord | null>;

  markFailed(context: TenantContext, sourceId: string, error: string): Promise<void>;

  listSources(context: TenantContext, projectId: string): Promise<KnowledgeSourceRecord[]>;

  /** As fontes da CONTA, de todos os projetos — é o que o S.O enxerga no inventário. */
  listAccountSources(context: TenantContext, limit: number): Promise<KnowledgeSourceRecord[]>;

  findSource(context: TenantContext, id: string): Promise<KnowledgeSourceRecord | null>;

  /** Uma revisão pelo id. É como o Lab lê o conhecimento CORRENTE, sem snapshot. */
  readRevision(context: TenantContext, id: string): Promise<KnowledgeRevisionRecord | null>;

  deleteSource(context: TenantContext, id: string): Promise<void>;

  /**
   * Congela as fontes READY do projeto num snapshot.
   *
   * `null` quando não há nenhuma — publicar um snapshot vazio guardaria um id
   * que não descreve nada, e o manifest passaria a mentir sobre ter congelado
   * conhecimento.
   */
  createSnapshot(
    context: TenantContext,
    input: { id: string; projectId: string; itemIds: string[]; newId: () => string },
  ): Promise<string | null>;

  /** O conteúdo congelado de um snapshot. É por aqui que o runtime lê. */
  readSnapshot(context: TenantContext, snapshotId: string): Promise<SnapshotEntry[]>;
}
