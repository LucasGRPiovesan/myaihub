import type { ProviderName } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/domain/errors.js';
import type { LlmProvider } from '../domain/provider.js';
import { FakeProvider } from '../infrastructure/providers/fake-provider.js';
import { UnavailableProvider } from '../infrastructure/providers/unavailable-provider.js';
import { ModelRouter, parseModelRoute, type RoleRoutes } from './model-router.js';

function routes(overrides: Partial<RoleRoutes> = {}): RoleRoutes {
  const fake = { provider: 'fake' as ProviderName, model: 'fake-1' };
  return {
    'hub.reasoning': fake,
    'hub.fast': fake,
    'agent.runtime': fake,
    'validation.fast': fake,
    'analysis.vision': fake,
    ...overrides,
  };
}

function providers(): Map<ProviderName, LlmProvider> {
  return new Map<ProviderName, LlmProvider>([
    ['fake', new FakeProvider()],
    ['gemini', new UnavailableProvider('gemini', 'GEMINI_API_KEY')],
  ]);
}

describe('parseModelRoute', () => {
  it('parseia provider e modelo', () => {
    expect(parseModelRoute('gemini:gemini-2.5-flash-lite')).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
    });
  });

  it('aceita dois-pontos dentro do nome do modelo', () => {
    expect(parseModelRoute('openai:gpt-4o:2024-08-06').model).toBe('gpt-4o:2024-08-06');
  });

  it.each(['gemini', ':modelo', 'gemini:', 'provider-desconhecido:modelo'])(
    'rejeita "%s"',
    (input) => {
      expect(() => parseModelRoute(input)).toThrow();
    },
  );
});

describe('ModelRouter', () => {
  it('resolve o provider do papel', () => {
    const router = new ModelRouter(routes(), providers());
    const resolved = router.resolve('hub.reasoning');

    expect(resolved.provider.name).toBe('fake');
    expect(resolved.model).toBe('fake-1');
  });

  it('permite papéis diferentes apontarem para providers diferentes', () => {
    const router = new ModelRouter(
      routes({ 'agent.runtime': { provider: 'gemini', model: 'gemini-2.5-flash-lite' } }),
      providers(),
    );

    expect(router.routeFor('agent.runtime').provider).toBe('gemini');
    expect(router.routeFor('hub.reasoning').provider).toBe('fake');
  });

  it('falha com PROVIDER_NOT_CONFIGURED quando falta a chave', () => {
    const router = new ModelRouter(
      routes({ 'hub.reasoning': { provider: 'gemini', model: 'gemini-2.5-flash-lite' } }),
      providers(),
    );

    try {
      router.resolve('hub.reasoning');
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PROVIDER_NOT_CONFIGURED');
      // 503, não 500: é configuração ausente, não bug.
      expect((error as AppError).httpStatus).toBe(503);
    }
  });

  it('falha só no ponto de uso — construir o router com provider sem chave é OK', () => {
    // O boot não pode quebrar por falta de chave de um provider que talvez nem
    // seja usado (§10).
    expect(
      () =>
        new ModelRouter(
          routes({ 'analysis.vision': { provider: 'gemini', model: 'x' } }),
          providers(),
        ),
    ).not.toThrow();
  });

  it('reporta provider não registrado como não configurado', () => {
    const router = new ModelRouter(
      routes({ 'hub.fast': { provider: 'anthropic', model: 'claude' } }),
      providers(),
    );

    expect(() => router.resolve('hub.fast')).toThrow(AppError);
  });

  describe('describe()', () => {
    it('lista todos os papéis com a disponibilidade real', () => {
      const router = new ModelRouter(
        routes({ 'analysis.vision': { provider: 'gemini', model: 'gemini-2.5-flash-lite' } }),
        providers(),
      );

      const described = router.describe();
      expect(described).toHaveLength(5);
      expect(described.find((item) => item.role === 'analysis.vision')?.available).toBe(false);
      expect(described.find((item) => item.role === 'hub.reasoning')?.available).toBe(true);
    });
  });
});
