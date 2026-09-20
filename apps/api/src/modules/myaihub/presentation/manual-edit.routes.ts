import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseBody, parseParams } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import { agentMutationSchema } from '../../agents/domain/mutations.js';
import { campaignMutationSchema } from '../../campaigns/domain/mutations.js';
import type { ApplyManualMutationsUseCase } from '../application/apply-manual-mutations.use-case.js';
import { canonicalMutationSchema } from '../domain/mutations.js';
import type { OperationTargetType } from '../domain/operation.js';

export interface ManualEditRouterDependencies {
  tokens: TokenService;
  applyManual: ApplyManualMutationsUseCase;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

/**
 * O corpo carrega as MESMAS mutações tipadas que o modelo produz.
 *
 * Um `PATCH { label, statement }` genérico seria mais curto de escrever e abriria
 * um segundo caminho de escrita no canônico, com outras regras — exatamente o
 * que o §7.2 proíbe. Aqui o remetente muda; o portão é o mesmo.
 */
function bodySchema(mutation: z.ZodType<{ kind: string }>) {
  return z.object({
    mutations: z.array(mutation).min(1).max(20),
    reason: z.string().trim().min(3).max(300).default('Edição manual'),
  });
}

const ROUTES: Array<{ path: string; targetType: OperationTargetType; mutation: z.ZodType }> = [
  { path: 'projects', targetType: 'PROJECT_PROFILE', mutation: canonicalMutationSchema },
  { path: 'agents', targetType: 'AGENT', mutation: agentMutationSchema },
  { path: 'campaigns', targetType: 'CAMPAIGN', mutation: campaignMutationSchema },
];

export function createManualEditRouter(deps: ManualEditRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  for (const route of ROUTES) {
    const schema = bodySchema(route.mutation as z.ZodType<{ kind: string }>);

    router.post(`/${route.path}/:id/mutations`, auth, async (request, response) => {
      const tenant = requireTenant(request);
      const { id } = parseParams(idParamSchema, request);
      const { mutations, reason } = parseBody(schema, request);

      const result = await deps.applyManual.execute(tenant, {
        targetType: route.targetType,
        targetId: id,
        mutations,
        reason,
      });

      response.json(result);
    });
  }

  return router;
}
