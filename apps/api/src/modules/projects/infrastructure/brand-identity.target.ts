import {
  defaultBrandIdentity,
  summarizeBrandIdentity,
  type CanonicalBrandIdentity,
} from '@myaihub/shared';
import type { IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { ContextBlock } from '../../ai/domain/context.js';
import { promptJson } from '../../myaihub/domain/prompt-json.js';
import type { MutationContext } from '../../myaihub/domain/mutation-applier.js';
import type {
  LoadedTarget,
  OperationTarget,
  PersistInput,
  PersistedTarget,
} from '../../myaihub/domain/operation-target.js';
import type { CanonicalMutation } from '../../myaihub/domain/mutations.js';
import { BrandIdentityMutationApplier } from '../domain/brand-mutation-applier.js';
import type { BrandMutation, BrandMutationKind } from '../domain/brand-mutations.js';
import type { BrandIdentityRepository } from '../domain/brand-repositories.js';
import type { ProjectRepository } from '../domain/repositories.js';

/**
 * A QUINTA implementação de `OperationTarget`, e a mais simples de todas.
 *
 * Ela vale como prova da abstração pelo lado oposto ao do playbook: aquele
 * mostrou que o runner não precisa saber que o agregado é de plataforma; este
 * mostra que ele não precisa saber que o documento NÃO TEM FACETAS. `facets()`
 * devolve vazio e o `guardAgainstRegression` simplesmente não tem itens a
 * proteger — o que é a verdade sobre este documento, não um caso especial.
 */
export class BrandIdentityTarget implements OperationTarget<
  CanonicalBrandIdentity,
  BrandMutation,
  BrandMutationKind
> {
  readonly entityType = 'PROJECT_BRAND_IDENTITY';
  private readonly applier = new BrandIdentityMutationApplier();

  constructor(
    private readonly brands: BrandIdentityRepository,
    private readonly projects: ProjectRepository,
    private readonly ids: IdGenerator,
  ) {}

  async load(
    context: TenantContext,
    targetId: string,
  ): Promise<LoadedTarget<CanonicalBrandIdentity> | null> {
    const project = await this.projects.findById(context, targetId);
    if (!project) return null;

    const current = await this.brands.findCurrent(context, targetId);

    return {
      entityId: project.project.id,
      // Projeto sem identidade parte do DEFAULT, não de um documento vazio: o
      // default é o que o público já vê hoje, e refinar sobre ele é o que o
      // usuário está de fato pedindo.
      canonical: current?.canonicalConfig ?? defaultBrandIdentity(project.project.name),
      versionId: current?.id ?? null,
      versionNumber: current?.versionNumber ?? null,
      lockVersion: project.project.lockVersion,
      displayName: project.project.name,
    };
  }

  empty(): CanonicalBrandIdentity {
    return defaultBrandIdentity('Marca');
  }

  facets(): readonly string[] {
    return [];
  }

  applyMutations(
    current: CanonicalBrandIdentity,
    mutations: BrandMutation[],
    mutationContext: MutationContext<BrandMutationKind>,
  ) {
    return this.applier.apply(current, mutations, mutationContext);
  }

  summarize(canonical: CanonicalBrandIdentity): string[] {
    return summarizeBrandIdentity(canonical);
  }

  contextBlock(canonical: CanonicalBrandIdentity, versionId: string | null): ContextBlock {
    return {
      id: 'project.brand_identity',
      kind: 'STABLE',
      trust: 'TRUSTED',
      priority: 80,
      essential: true,
      cacheable: true,
      content: promptJson(canonical),
      ...(versionId ? { sourceVersionId: versionId } : {}),
    };
  }

  /**
   * O PERFIL entra como leitura.
   *
   * Sem ele o modelo escreveria uma tagline para um negócio que não conhece — e
   * tagline genérica é exatamente o que o usuário veio evitar ao pedir ajuda
   * com a marca.
   */
  async relatedContext(
    context: TenantContext,
    ids: { parentId: string | null; entityId: string | null },
  ): Promise<ContextBlock[]> {
    const projectId = ids.entityId ?? ids.parentId;
    if (!projectId) return [];

    const project = await this.projects.findById(context, projectId);
    if (!project?.profile) return [];

    return [
      {
        id: 'project.profile',
        kind: 'KNOWLEDGE',
        trust: 'TRUSTED',
        priority: 70,
        cacheable: true,
        content: promptJson(project.profile.canonicalConfig),
        sourceVersionId: project.profile.id,
      },
    ];
  }

  async persist(
    context: TenantContext,
    input: PersistInput<CanonicalBrandIdentity, BrandMutation>,
  ): Promise<PersistedTarget> {
    if (!input.existing) {
      // Identidade de marca não CRIA projeto: ela é uma faceta de um projeto que
      // já existe. Chegar aqui sem alvo é rota mal montada, não caso de uso.
      throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');
    }

    const saved = await this.brands.update(context, {
      projectId: input.existing.entityId,
      expectedLockVersion: input.existing.lockVersion,
      version: {
        id: this.ids.generate(),
        canonicalConfig: input.canonical,
        humanSummary: input.humanSummary,
        source: 'MYAIHUB',
        reason: input.interpretedIntent,
      },
      change: {
        id: this.ids.generate(),
        entityType: 'PROJECT_BRAND_IDENTITY',
        fromVersionId: input.existing.versionId,
        fromVersion: input.existing.versionNumber,
        source: 'MYAIHUB',
        actorUserId: context.userId,
        hubOperationId: input.hubOperationId,
        hubMessageId: input.hubMessageId,
        interpretedIntent: input.interpretedIntent,
        // O change guarda a mutação tipada como ela foi aplicada. O tipo do
        // registro é o do canônico do projeto — as duas uniões convivem na
        // mesma coluna, e é o `entityType` que diz qual delas ler.
        mutations: input.mutations as unknown as CanonicalMutation[],
        rationale: input.rationale,
      },
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: 'project.brand_identity_updated',
        entityType: 'Project',
        entityId: input.existing.entityId,
        metadata: { intent: input.interpretedIntent },
      },
    });

    return {
      entityId: input.existing.entityId,
      versionNumber: saved.versionNumber,
      displayName: input.existing.displayName,
    };
  }
}
