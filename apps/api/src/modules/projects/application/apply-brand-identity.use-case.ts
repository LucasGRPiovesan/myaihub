import { defaultBrandIdentity, summarizeBrandIdentity } from '@myaihub/shared';
import type { IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { BrandIdentityMutationApplier } from '../domain/brand-mutation-applier.js';
import type { BrandMutation } from '../domain/brand-mutations.js';
import type { BrandIdentityRepository } from '../domain/brand-repositories.js';
import type { ProjectRepository } from '../domain/repositories.js';

/**
 * Gravar a identidade de marca — UMA porta, para a tela e para o S.O.
 *
 * A lógica morava dentro da rota `POST /projects/:id/brand/mutations`. Assim
 * que a criação de projeto passou a extrair a identidade visual do site, ela
 * precisava gravar a mesma coisa — e copiar o bloco para o runner criaria o
 * segundo caminho de escrita da marca, que é justamente o que este repositório
 * já pagou para aprender que diverge (o primeiro recebe as correções, o segundo
 * não). É a mesma extração que `BindCampaignAgent` e `SyncAgentCraft` sofreram
 * quando o S.O passou a executar ações do sistema.
 *
 * `source` distingue quem escreveu: a tela grava `USER`, o S.O grava `MYAIHUB`.
 * Não é escrituração inútil — é o que permite ao `MYAIHUB_BASELINE` do agente e
 * à marca serem reconciliados quando o usuário depois contradiz o que foi
 * inferido do site.
 */
export interface ApplyBrandIdentityInput {
  projectId: string;
  mutations: BrandMutation[];
  reason: string;
  source: 'USER' | 'MYAIHUB';
  hubOperationId?: string | null;
  hubMessageId?: string | null;
  rationale?: string;
}

export interface ApplyBrandIdentityResult {
  versionNumber: number;
  canonical: ReturnType<typeof defaultBrandIdentity>;
  summary: string[];
  /** O que o domínio corrigiu sozinho — contraste, acima de tudo. */
  adjustments: string[];
  rejected: Array<{ kind: string; reason: string }>;
}

export class ApplyBrandIdentityUseCase {
  private readonly applier = new BrandIdentityMutationApplier();

  constructor(
    private readonly deps: {
      brands: BrandIdentityRepository;
      projects: ProjectRepository;
      ids: IdGenerator;
    },
  ) {}

  async execute(
    context: TenantContext,
    input: ApplyBrandIdentityInput,
  ): Promise<ApplyBrandIdentityResult> {
    const project = await this.deps.projects.findById(context, input.projectId);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

    const current = await this.deps.brands.findCurrent(context, input.projectId);
    // Projeto sem identidade parte do DEFAULT, não de um documento vazio: o
    // default é o que o público já vê, e ajustar sobre ele é o que foi pedido.
    const canonical = current?.canonicalConfig ?? defaultBrandIdentity(project.project.name);

    const applied = this.applier.apply(canonical, input.mutations, {
      allowedMutations: ['SET_BRAND_IDENTITY'],
      now: new Date(),
      nextId: () => this.deps.ids.generate(),
      source: input.source,
      validateCheck: () => ({ ok: false, reason: 'A identidade de marca não tem checkers.' }),
    });

    const saved = await this.deps.brands.update(context, {
      projectId: input.projectId,
      expectedLockVersion: project.project.lockVersion,
      version: {
        id: this.deps.ids.generate(),
        canonicalConfig: applied.canonical,
        humanSummary: summarizeBrandIdentity(applied.canonical),
        source: input.source,
        reason: input.reason,
      },
      change: {
        id: this.deps.ids.generate(),
        entityType: 'PROJECT_BRAND_IDENTITY',
        fromVersionId: current?.id ?? null,
        fromVersion: current?.versionNumber ?? null,
        source: input.source,
        actorUserId: context.userId,
        hubOperationId: input.hubOperationId ?? null,
        hubMessageId: input.hubMessageId ?? null,
        interpretedIntent: input.reason,
        mutations: [],
        rationale: input.rationale ?? 'Edição manual pela tela da marca.',
      },
      audit: {
        accountId: context.accountId,
        actorUserId: context.userId,
        action: 'project.brand_identity_updated',
        entityType: 'Project',
        entityId: input.projectId,
        metadata: { source: input.source },
      },
    });

    return {
      versionNumber: saved.versionNumber,
      canonical: saved.canonicalConfig,
      summary: saved.humanSummary,
      adjustments: applied.adjustments,
      rejected: applied.rejected,
    };
  }
}
