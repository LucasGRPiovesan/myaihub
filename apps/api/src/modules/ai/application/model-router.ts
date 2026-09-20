import { MODEL_ROLES, PROVIDER_NAMES, type ModelRole, type ProviderName } from '@myaihub/shared';
import { AppError } from '../../../shared/domain/errors.js';
import type { LlmProvider } from '../domain/provider.js';

export interface ModelRoute {
  provider: ProviderName;
  model: string;
}

/** Parseia `<provider>:<model>` vindo da env. */
export function parseModelRoute(value: string): ModelRoute {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Rota de modelo inválida: "${value}". Formato esperado: <provider>:<model>.`);
  }

  const provider = value.slice(0, separator).trim().toLowerCase();
  const model = value.slice(separator + 1).trim();

  if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) {
    throw new Error(
      `Provider desconhecido: "${provider}". Conhecidos: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }

  return { provider: provider as ProviderName, model };
}

export type RoleRoutes = Record<ModelRole, ModelRoute>;

/**
 * ModelRouter (§10).
 *
 * O código pede um PAPEL (`hub.reasoning`), não um modelo. Qual provider e
 * modelo atendem esse papel é configuração de ambiente — é o que permite
 * trocar de provider sem tocar em nenhum use case.
 */
export class ModelRouter {
  constructor(
    /**
     * De onde vem a rota de cada papel.
     *
     * Era um objeto fixo, montado no boot a partir da env. Passou a ser uma
     * FUNÇÃO porque a escolha deixou de ser só de ambiente: o admin troca o
     * modelo por tela, e a cota gratuita trava a escolha enquanto existir.
     * Resolver na hora da chamada é o que faz a troca valer sem reiniciar.
     */
    private readonly routes: RoleRoutes | (() => RoleRoutes),
    private readonly providers: Map<ProviderName, LlmProvider>,
  ) {}

  private current(): RoleRoutes {
    return typeof this.routes === 'function' ? this.routes() : this.routes;
  }

  routeFor(role: ModelRole): ModelRoute {
    const route = this.current()[role];
    if (!route) {
      throw new Error(`Papel de modelo não configurado: ${role}.`);
    }
    return route;
  }

  /**
   * Resolve o provider do papel.
   *
   * Provider sem chave lança PROVIDER_NOT_CONFIGURED aqui, no ponto de uso —
   * e não no boot. Um MyAIHub que não sobe porque falta a chave da OpenAI,
   * mesmo usando só Gemini, seria pior que inútil (§10).
   */
  resolve(role: ModelRole): { provider: LlmProvider; model: string } {
    const route = this.routeFor(role);
    const provider = this.providers.get(route.provider);

    if (!provider) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `Provider "${route.provider}" não está registrado.`,
        { httpStatus: 503 },
      );
    }

    if (!provider.available) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `O provider "${route.provider}" não tem chave configurada. ` +
          `Defina a variável de ambiente correspondente ou aponte o papel "${role}" para outro provider.`,
        { httpStatus: 503 },
      );
    }

    return { provider, model: route.model };
  }

  /** Diagnóstico: o que está configurado e o que está disponível. */
  describe(): Array<{
    role: ModelRole;
    provider: ProviderName;
    model: string;
    available: boolean;
  }> {
    const routes = this.current();
    return MODEL_ROLES.map((role) => {
      const route = routes[role];
      return {
        role,
        provider: route.provider,
        model: route.model,
        available: this.providers.get(route.provider)?.available ?? false,
      };
    });
  }
}
