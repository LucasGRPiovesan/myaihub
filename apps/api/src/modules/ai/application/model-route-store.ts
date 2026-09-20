import { FREE_TIER_ROUTE, MODEL_ROLES, type ModelRole } from '@myaihub/shared';
import type { Logger } from '../../../shared/application/ports.js';
import type { ModelRoute, RoleRoutes } from './model-router.js';

/**
 * De onde sai a rota de cada papel, em ordem de precedência.
 *
 *   1. A COTA GRATUITA, quando está de pé — e ela ganha de tudo. Gastar num
 *      modelo pago tendo requisição gratuita disponível é queimar dinheiro por
 *      opção de tela, então enquanto a cota existe a escolha fica travada no
 *      modelo que ela serve. Esgotada, a escolha do admin passa a valer:
 *      aí já se está pagando de qualquer jeito, e vale escolher bem.
 *   2. A escolha do ADMIN, gravada em `model_routes`.
 *   3. O padrão da ENV, que é o que faz o sistema subir num banco novo.
 *
 * O estado vive em memória e é recarregado a cada escrita. É um processo só em
 * desenvolvimento; com várias instâncias, cada uma leria o próprio cache até a
 * próxima escrita — e a correção ali é invalidação por evento, não polling.
 */
export interface ModelRouteRepository {
  /** Todas as rotas gravadas. Papel ausente = não foi escolhido. */
  list(): Promise<Array<{ role: ModelRole; route: ModelRoute }>>;
  save(role: ModelRole, route: ModelRoute, actorUserId: string): Promise<void>;
}

export class ModelRouteStore {
  /** O que o admin escolheu. Vazio até alguém abrir a tela. */
  private escolhidas = new Map<ModelRole, ModelRoute>();

  constructor(
    private readonly deps: {
      repository: ModelRouteRepository;
      /** Os padrões da env — o piso, e o que vale num banco recém-criado. */
      defaults: RoleRoutes;
      /**
       * A cota que está servindo agora.
       *
       * `null` quando o provider não distingue cotas (é o caso do Fake) — aí
       * não há trava, e o que vale é a escolha do admin.
       */
      quota: () => 'FREE' | 'PAID' | null;
      logger: Logger;
    },
  ) {}

  /** Carrega o que está gravado. Falhar aqui não derruba o boot: a env cobre. */
  async load(): Promise<void> {
    try {
      const gravadas = await this.deps.repository.list();
      this.escolhidas = new Map(gravadas.map((linha) => [linha.role, linha.route]));
    } catch (error) {
      this.deps.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'não foi possível ler as rotas de modelo; seguindo com os padrões da env',
      );
    }
  }

  async save(role: ModelRole, route: ModelRoute, actorUserId: string): Promise<void> {
    await this.deps.repository.save(role, route, actorUserId);
    this.escolhidas.set(role, route);
  }

  /** A trava está ativa? A tela usa isto para explicar por que os selects não abrem. */
  get lockedToFreeTier(): boolean {
    return this.deps.quota() === 'FREE';
  }

  /** A rota que vale AGORA para este papel, com a precedência inteira aplicada. */
  routeFor(role: ModelRole): ModelRoute {
    if (this.lockedToFreeTier) return { ...FREE_TIER_ROUTE };
    return this.escolhidas.get(role) ?? this.deps.defaults[role];
  }

  /** O que o admin escolheu, sem a trava — é isso que a tela mostra selecionado. */
  selectionFor(role: ModelRole): { route: ModelRoute; source: 'ADMIN' | 'ENV' } {
    const escolhida = this.escolhidas.get(role);
    return escolhida
      ? { route: escolhida, source: 'ADMIN' }
      : { route: this.deps.defaults[role], source: 'ENV' };
  }

  /** Todas as rotas resolvidas, para o router e para diagnóstico. */
  all(): RoleRoutes {
    return Object.fromEntries(MODEL_ROLES.map((role) => [role, this.routeFor(role)])) as RoleRoutes;
  }
}
