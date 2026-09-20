import { AI_MODEL_CATALOG, MODEL_ROLES, type ModelRole, type ProviderName } from '@myaihub/shared';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError } from '../../../shared/domain/errors.js';
import type { LlmProvider } from '../domain/provider.js';
import type { ModelRouteStore } from './model-route-store.js';

/**
 * Qual modelo atende um papel — decisão do ADMIN da plataforma.
 *
 * Saiu da rota porque tem dois chamadores: o gestor de modelos e o S.O. A
 * checagem de papel mora AQUI, e não só no middleware: pelo S.O não existe
 * `requireRole` no caminho, e trocar o modelo afeta todas as contas.
 */
export class ChangeModelRouteUseCase {
  constructor(
    private readonly deps: {
      store: ModelRouteStore;
      providers: Map<ProviderName, LlmProvider>;
      audit: AuditWriter;
    },
  ) {}

  async execute(
    context: TenantContext,
    input: { role: string; provider: string; model: string; requestId?: string },
  ) {
    if (context.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'Só o administrador da plataforma troca o modelo.', {
        httpStatus: 403,
      });
    }

    const role = input.role as ModelRole;
    if (!(MODEL_ROLES as readonly string[]).includes(role)) {
      throw new AppError('VALIDATION_ERROR', `Papel de modelo desconhecido: "${input.role}".`, {
        httpStatus: 422,
      });
    }

    // O modelo tem que existir no CATÁLOGO. Sem isto, um id digitado errado
    // viraria erro do provider no meio da próxima operação do usuário — longe
    // daqui, e sem dizer que a causa foi esta escolha.
    const catalogo = AI_MODEL_CATALOG.find((entry) => entry.provider === input.provider);
    if (!catalogo?.models.some((modelo) => modelo.id === input.model)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `O modelo "${input.model}" não existe no catálogo de ${input.provider}.`,
        { httpStatus: 422 },
      );
    }

    const provider = catalogo.provider;

    // E o provider tem que estar ATIVO. Apontar um papel para um provider sem
    // chave deixaria o sistema quebrado até alguém desfazer.
    if (!this.deps.providers.get(provider)?.available) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `O provider "${provider}" não tem chave configurada (${catalogo.envKey}).`,
        { httpStatus: 422 },
      );
    }

    const escolhido = { provider, model: input.model };
    await this.deps.store.save(role, escolhido, context.userId ?? '');

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'ADMIN_MODEL_ROUTE_CHANGED',
      entityType: 'MODEL_ROUTE',
      entityId: role,
      metadata: { role, ...escolhido },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    return {
      role,
      selected: escolhido,
      effective: this.deps.store.routeFor(role),
      lockedToFreeTier: this.deps.store.lockedToFreeTier,
    };
  }
}
