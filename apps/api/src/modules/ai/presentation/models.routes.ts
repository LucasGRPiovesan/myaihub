import {
  AI_MODEL_CATALOG,
  MODEL_ROLES,
  MODEL_ROLE_LABELS,
  PROVIDER_NAMES,
  type ProviderName,
} from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireRole,
  requireTenant,
} from '../../../http/middlewares/authenticate.js';
import { parseBody } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import type { LlmProvider } from '../domain/provider.js';
import type { ModelRouteStore } from '../application/model-route-store.js';
import type { ChangeModelRouteUseCase } from '../application/change-model-route.use-case.js';

export interface ModelsRouterDependencies {
  tokens: TokenService;
  store: ModelRouteStore;
  providers: Map<ProviderName, LlmProvider>;
  change: ChangeModelRouteUseCase;
}

const escolha = z.object({
  provider: z.enum(PROVIDER_NAMES),
  model: z.string().trim().min(1).max(120),
});

/**
 * O gestor de modelos — só para quem administra a PLATAFORMA.
 *
 * Qual modelo atende cada papel sempre foi rota por papel; o que muda aqui é
 * quem decide: era quem reiniciava o processo com outra env, passa a ser uma
 * tela. A abstração não muda — nenhum use case sabe que modelo está falando.
 *
 * `requireRole('ADMIN')` e não papel de conta: trocar o modelo afeta TODAS as
 * contas e a fatura da plataforma. Dono de uma conta não decide isso, do mesmo
 * jeito que não edita o playbook que as outras herdam.
 */
export function createModelsRouter(deps: ModelsRouterDependencies): Router {
  const router = Router();
  const admin = [authenticate(deps.tokens), requireRole('ADMIN')];

  router.get('/admin/models', ...admin, (_request, response) => {
    response.json({
      // O catálogo vai INTEIRO, com os providers ainda sem chave marcados como
      // indisponíveis: a tela mostra o que existirá quando a chave entrar, e
      // diz qual variável falta. Esconder seria fingir que não há caminho.
      providers: AI_MODEL_CATALOG.map((entry) => ({
        ...entry,
        available: deps.providers.get(entry.provider)?.available ?? false,
      })),
      roles: MODEL_ROLES.map((role) => {
        const selecionado = deps.store.selectionFor(role);
        return {
          role,
          ...MODEL_ROLE_LABELS[role],
          selected: selecionado.route,
          source: selecionado.source,
          /** O que vai ser usado de fato — difere do escolhido sob a trava. */
          effective: deps.store.routeFor(role),
        };
      }),
      /**
       * A TRAVA da cota gratuita.
       *
       * Enquanto ela existir, a escolha não vale: gastar num modelo pago tendo
       * requisição gratuita disponível é queimar dinheiro por opção de tela. A
       * tela precisa DIZER isso — select desabilitado sem motivo é bug aos
       * olhos de quem usa.
       */
      lockedToFreeTier: deps.store.lockedToFreeTier,
    });
  });

  router.put('/admin/models/:role', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const escolhido = parseBody(escolha, request);

    response.json(
      await deps.change.execute(tenant, {
        role: String(request.params.role ?? ''),
        ...escolhido,
        ...(request.requestId ? { requestId: request.requestId } : {}),
      }),
    );
  });

  return router;
}
