import { MODEL_ROLES, PROVIDER_NAMES, type ModelRole, type ProviderName } from '@myaihub/shared';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type { ModelRouteRepository } from '../application/model-route-store.js';
import type { ModelRoute } from '../application/model-router.js';

/**
 * A escolha de modelo do admin, no banco.
 *
 * Sem `TenantContext`: a tabela é UNSCOPED, como a Master Policy e os
 * playbooks — qual modelo atende cada papel é decisão da PLATAFORMA, e uma
 * conta não escolhe o modelo que as outras usam.
 *
 * Linha com papel ou provider que o código não conhece mais é IGNORADA na
 * leitura, não rejeitada: um deploy que remove um papel não pode impedir o
 * sistema de subir por causa de uma linha órfã.
 */
export class PrismaModelRouteRepository implements ModelRouteRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Array<{ role: ModelRole; route: ModelRoute }>> {
    const linhas = await this.db.modelRoute.findMany();

    return linhas.flatMap((linha) => {
      if (!(MODEL_ROLES as readonly string[]).includes(linha.role)) return [];
      if (!(PROVIDER_NAMES as readonly string[]).includes(linha.provider)) return [];

      return [
        {
          role: linha.role as ModelRole,
          route: { provider: linha.provider as ProviderName, model: linha.model },
        },
      ];
    });
  }

  async save(role: ModelRole, route: ModelRoute, actorUserId: string): Promise<void> {
    await this.db.modelRoute.upsert({
      where: { role },
      create: {
        role,
        provider: route.provider,
        model: route.model,
        updatedBy: actorUserId,
      },
      update: { provider: route.provider, model: route.model, updatedBy: actorUserId },
    });
  }
}
