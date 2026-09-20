import { z } from 'zod';

/**
 * Knowledge Sources do projeto (§4.4, Fase 5).
 *
 * Contratos, não canônico: uma fonte de conhecimento NÃO é um documento
 * versionado por mutação tipada — é um arquivo/página com conteúdo extraído. O
 * que é versionado é a REVISÃO, e ela é imutável por construção.
 *
 * A distinção importa: o OS muta configuração; conhecimento ele LÊ. Deixar o
 * modelo reescrever o conteúdo de uma fonte transformaria a base de
 * conhecimento do cliente em paráfrase — o mesmo erro que já custou caro no
 * playbook.
 */

export const KNOWLEDGE_SOURCE_KINDS = ['TEXT', 'URL'] as const;
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

export const KNOWLEDGE_SOURCE_STATUSES = ['PENDING', 'READY', 'FAILED'] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export const KNOWLEDGE_SOURCE_KIND_LABELS: Record<KnowledgeSourceKind, string> = {
  TEXT: 'Texto',
  URL: 'Página',
};

/** Teto de um conteúdo extraído. Acima disso o corte é do leitor, não do banco. */
export const KNOWLEDGE_MAX_CONTENT = 200_000;

export const createKnowledgeSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TEXT'),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(KNOWLEDGE_MAX_CONTENT),
  }),
  z.object({
    kind: z.literal('URL'),
    title: z.string().trim().min(1).max(200),
    uri: z.string().trim().url().max(2000),
  }),
]);

export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceSchema>;

export interface KnowledgeSourceView {
  id: string;
  kind: KnowledgeSourceKind;
  status: KnowledgeSourceStatus;
  title: string;
  uri: string | null;
  revisionNumber: number | null;
  contentLength: number;
  lastError: string | null;
  extractedAt: string | null;
  createdAt: string;
}

/**
 * Trecho recuperado que entrou no contexto de um turno.
 *
 * Viaja para o Lab (é o que o Lab existe para mostrar) e para o
 * `ExecutionTrace`: sem saber QUAL trecho entrou, "reproduzível" é promessa.
 */
export interface KnowledgeReference {
  sourceId: string;
  revisionId: string;
  title: string;
  /** Trecho efetivamente injetado, já cortado. */
  excerpt: string;
  /** Quantos termos da pergunta bateram. Explica por que este trecho e não outro. */
  score: number;
}
