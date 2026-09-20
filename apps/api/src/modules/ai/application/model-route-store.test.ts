import { FREE_TIER_ROUTE, type ModelRole } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { ModelRouteStore, type ModelRouteRepository } from './model-route-store.js';
import type { ModelRoute, RoleRoutes } from './model-router.js';

const SILENT = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

const DEFAULTS: RoleRoutes = {
  'hub.reasoning': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'hub.fast': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'agent.runtime': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'validation.fast': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'analysis.vision': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
};

function repositorio(iniciais: Array<{ role: ModelRole; route: ModelRoute }> = []) {
  const linhas = new Map(iniciais.map((linha) => [linha.role, linha.route]));
  const repository: ModelRouteRepository = {
    list: async () => [...linhas].map(([role, route]) => ({ role, route })),
    save: async (role, route) => {
      linhas.set(role, route);
    },
  };
  return repository;
}

function loja(
  quota: 'FREE' | 'PAID' | null,
  iniciais?: Array<{ role: ModelRole; route: ModelRoute }>,
) {
  return new ModelRouteStore({
    repository: repositorio(iniciais),
    defaults: DEFAULTS,
    quota: () => quota,
    logger: SILENT,
  });
}

describe('rota de modelo por papel', () => {
  it('sem escolha do admin, vale o padrão da env', async () => {
    const store = loja('PAID');
    await store.load();

    expect(store.routeFor('hub.reasoning')).toEqual(DEFAULTS['hub.reasoning']);
    expect(store.selectionFor('hub.reasoning').source).toBe('ENV');
  });

  it('a escolha do admin vence a env quando a cota é PAGA', async () => {
    const store = loja('PAID');
    await store.load();
    await store.save('hub.reasoning', { provider: 'gemini', model: 'gemini-3.5-pro' }, '01USER');

    expect(store.routeFor('hub.reasoning').model).toBe('gemini-3.5-pro');
    expect(store.selectionFor('hub.reasoning').source).toBe('ADMIN');
  });

  it('A COTA GRATUITA vence tudo — inclusive a escolha do admin', async () => {
    // Gastar num modelo pago tendo requisição gratuita disponível é queimar
    // dinheiro por opção de tela.
    const store = loja('FREE');
    await store.load();
    await store.save('hub.reasoning', { provider: 'gemini', model: 'gemini-3.5-pro' }, '01USER');

    expect(store.lockedToFreeTier).toBe(true);
    expect(store.routeFor('hub.reasoning')).toEqual(FREE_TIER_ROUTE);
  });

  it('sob a trava, a escolha continua GRAVADA e volta a valer quando a cota acaba', async () => {
    // O que a trava faz é adiar a escolha, não apagá-la: descartar o que o
    // admin escolheu obrigaria a reescolher toda vez que a cota virasse.
    const repository = repositorio();
    const escolhida = { provider: 'gemini' as const, model: 'gemini-3.5-pro' };

    const travada = new ModelRouteStore({
      repository,
      defaults: DEFAULTS,
      quota: () => 'FREE',
      logger: SILENT,
    });
    await travada.load();
    await travada.save('agent.runtime', escolhida, '01USER');
    expect(travada.routeFor('agent.runtime')).toEqual(FREE_TIER_ROUTE);
    expect(travada.selectionFor('agent.runtime').route).toEqual(escolhida);

    const paga = new ModelRouteStore({
      repository,
      defaults: DEFAULTS,
      quota: () => 'PAID',
      logger: SILENT,
    });
    await paga.load();
    expect(paga.routeFor('agent.runtime')).toEqual(escolhida);
  });

  it('provider sem distinção de cota não trava nada', async () => {
    // É o caso do FakeProvider: não existe cota gratuita para respeitar.
    const store = loja(null);
    await store.load();
    await store.save('agent.runtime', { provider: 'fake', model: 'fake-1' }, '01USER');

    expect(store.lockedToFreeTier).toBe(false);
    expect(store.routeFor('agent.runtime').model).toBe('fake-1');
  });

  it('falha ao ler o banco não derruba nada: a env cobre', async () => {
    const store = new ModelRouteStore({
      repository: {
        list: async () => {
          throw new Error('banco fora');
        },
        save: async () => undefined,
      },
      defaults: DEFAULTS,
      quota: () => 'PAID',
      logger: SILENT,
    });

    await expect(store.load()).resolves.toBeUndefined();
    expect(store.routeFor('hub.reasoning')).toEqual(DEFAULTS['hub.reasoning']);
  });

  it('`all()` resolve TODOS os papéis — é o que o router pergunta a cada chamada', async () => {
    const store = loja('FREE');
    await store.load();

    const todas = Object.values(store.all());
    expect(todas).toHaveLength(5);
    expect(todas.every((rota) => rota.model === FREE_TIER_ROUTE.model)).toBe(true);
  });
});
