import type { ModelRole, ProviderName } from '@myaihub/shared';
import { env, isTest } from '../../../config/env.js';
import type { Logger } from '../../../shared/application/ports.js';
import { ModelRouter, parseModelRoute, type RoleRoutes } from '../application/model-router.js';
import type { LlmProvider } from '../domain/provider.js';

/** Modelo usado quando tudo aponta para o FakeProvider. */
export const FAKE_MODEL = 'fake-1';

/**
 * As rotas que a ENV declara — o piso de tudo.
 *
 * É o que vale num banco que nunca teve a tela do admin aberta, e é o que a
 * suíte usa: em teste TODO papel vai para o FakeProvider, mesmo com chave real
 * no `.env`, porque nenhum teste pode consumir API paga (invariante 8). Depender
 * de disciplina em cada teste não funcionaria.
 */
export function defaultRoutes(): RoleRoutes {
  if (isTest) {
    return {
      'hub.reasoning': { provider: 'fake', model: FAKE_MODEL },
      'hub.fast': { provider: 'fake', model: FAKE_MODEL },
      'agent.runtime': { provider: 'fake', model: FAKE_MODEL },
      'validation.fast': { provider: 'fake', model: FAKE_MODEL },
      'analysis.vision': { provider: 'fake', model: FAKE_MODEL },
    };
  }

  return {
    'hub.reasoning': parseModelRoute(env.MODEL_ROLE_HUB_REASONING),
    'hub.fast': parseModelRoute(env.MODEL_ROLE_HUB_FAST),
    'agent.runtime': parseModelRoute(env.MODEL_ROLE_AGENT_RUNTIME),
    'validation.fast': parseModelRoute(env.MODEL_ROLE_VALIDATION_FAST),
    'analysis.vision': parseModelRoute(env.MODEL_ROLE_ANALYSIS_VISION),
  };
}

export function createModelRouter(
  providers: Map<ProviderName, LlmProvider>,
  logger: Logger,
  /**
   * De onde a rota de cada papel sai A CADA CHAMADA.
   *
   * Era sempre o objeto fixo da env. Passou a poder ser função porque a escolha
   * deixou de ser só de ambiente: o admin troca o modelo por tela e a cota
   * gratuita trava a escolha enquanto existir — resolver na hora é o que faz a
   * troca valer sem reiniciar o processo.
   *
   * Ausente, vale a env: é o caso do teste e de qualquer uso sem banco por perto.
   */
  resolve?: () => RoleRoutes,
): ModelRouter {
  const router = new ModelRouter(resolve ?? defaultRoutes(), providers);

  const unavailable = router.describe().filter((entry) => !entry.available);
  if (unavailable.length > 0) {
    // Aviso, não erro: o sistema sobe e só falha se o papel for realmente usado.
    logger.warn(
      { roles: unavailable.map((entry) => `${entry.role}=${entry.provider}`) },
      'papéis de modelo apontam para providers sem chave configurada',
    );
  }

  return router;
}

export type { ModelRole };
