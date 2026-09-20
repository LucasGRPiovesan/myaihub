import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { ContextBlock } from '../../ai/domain/context.js';
import type { LevelTerm } from './level-leak.js';
import type { MutationContext, MutationRejection } from './mutation-applier.js';

/**
 * O que uma operação do OS sabe fazer com o agregado que ela configura.
 *
 * Existe porque há DOIS agregados versionados de verdade (Project Profile e
 * Agent Core) com o mesmo ciclo — carregar, aplicar mutações tipadas, versionar
 * numa transação com change e auditoria. Abstrair antes do segundo teria sido
 * generalização especulativa; abstrair agora remove duplicação real.
 *
 * Campaign (Fase 7) entra como uma terceira implementação, sem tocar no runner.
 */

export interface LoadedTarget<TCanonical> {
  entityId: string;
  canonical: TCanonical;
  versionId: string | null;
  versionNumber: number | null;
  /** Versão lida, para o lock otimista da escrita (§70). */
  lockVersion: number;
  /** Nome exibido no painel vivo. */
  displayName: string;
}

export interface PersistedTarget {
  entityId: string;
  versionNumber: number;
  displayName: string;
}

export interface PersistInput<TCanonical, TMutation> {
  existing: LoadedTarget<TCanonical> | null;
  /** Dono do agregado, quando ele nasce dentro de outro (campanha → projeto). */
  parentId: string | null;
  canonical: TCanonical;
  humanSummary: string[];
  mutations: TMutation[];
  interpretedIntent: string;
  rationale: string;
  /** Nulos na edição MANUAL: não houve operação do OS nem fala do usuário. */
  hubOperationId: string | null;
  hubMessageId: string | null;
}

export interface OperationTarget<TCanonical, TMutation, TKind extends string> {
  /** Vai para ConfigurationChange.entityType e AuditLog.entityType. */
  entityType: string;

  load(context: TenantContext, targetId: string): Promise<LoadedTarget<TCanonical> | null>;

  /** Documento inicial de um agregado que ainda não existe. */
  empty(): TCanonical;

  /**
   * Facetas que carregam `CanonicalItem[]`.
   *
   * O runner usa para garantir não-regressão sem conhecer o formato do
   * documento — quem sabe quais são as facetas é o alvo.
   */
  facets(): readonly string[];

  applyMutations(
    current: TCanonical,
    mutations: TMutation[],
    mutationContext: MutationContext<TKind>,
  ): {
    canonical: TCanonical;
    applied: TMutation[];
    rejected: MutationRejection[];
    adjustments: string[];
  };

  summarize(canonical: TCanonical): string[];

  /** Bloco de contexto com o estado atual, para o modelo refinar em vez de recriar. */
  contextBlock(canonical: TCanonical, versionId: string | null): ContextBlock;

  /**
   * Blocos ALÉM do próprio documento.
   *
   * Uma campanha não se explica sozinha: ela existe dentro de um projeto e é
   * executada por um agente. Sem esses dois no contexto, o modelo escreveria
   * uma estratégia genérica que não conhece nem o negócio nem quem vai falar.
   */
  relatedContext?(
    context: TenantContext,
    ids: { parentId: string | null; entityId: string | null },
  ): Promise<ContextBlock[]>;

  /**
   * Níveis cujos NOMES não podem aparecer no que o modelo escreve aqui.
   *
   * O agente é da conta: nome de projeto ou campanha dentro dele congela um
   * negócio no que deveria servir a qualquer um (ver `level-leak.ts`).
   * Declarado pelo alvo para o runner não precisar de um `if` por tipo.
   */
  levelBoundary?: readonly LevelTerm['level'][];

  persist(
    context: TenantContext,
    input: PersistInput<TCanonical, TMutation>,
  ): Promise<PersistedTarget>;
}
