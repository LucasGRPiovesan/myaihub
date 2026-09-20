import { PROVIDER_KEY_SLOTS, PROVIDER_NAMES, type ProviderName } from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseBody, parseParams } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import type { CredentialCipher } from '../../../shared/infrastructure/crypto/credential-cipher.js';
import { maskApiKey } from '../../../shared/infrastructure/crypto/credential-cipher.js';
import type { LlmProvider } from '../domain/provider.js';
import { GeminiProvider } from '../infrastructure/providers/gemini-provider.js';
import type { ManageProviderCredentialsUseCase } from '../application/manage-provider-credentials.use-case.js';
import type { ProviderCredentialRepository } from '../application/provider-credentials.js';

export interface ProviderCredentialsRouterDependencies {
  tokens: TokenService;
  repository: ProviderCredentialRepository;
  providers: Map<ProviderName, LlmProvider>;
  cipher: CredentialCipher;
  manage: ManageProviderCredentialsUseCase;
}

const PROVIDER_PARAM_PROVIDERS = PROVIDER_NAMES.filter((provider) => provider !== 'fake') as Exclude<
  ProviderName,
  'fake'
>[];

const providerParam = z.object({ provider: z.enum(PROVIDER_PARAM_PROVIDERS) });
const keyParam = providerParam.extend({ kind: z.string().trim().min(1).max(10) });

/**
 * Gestor de PROVEDORES — chave e liga/desliga, só para quem administra a
 * PLATAFORMA. Mesma fronteira do gestor de modelos (`models.routes.ts`):
 * trocar uma chave afeta a fatura e o funcionamento de todas as contas.
 *
 * `fake` fica fora: não é um provider que se gerencia, é o dublê dos testes.
 */
export function createProviderCredentialsRouter(
  deps: ProviderCredentialsRouterDependencies,
): Router {
  const router = Router();
  const admin = [authenticate(deps.tokens), requireRole('ADMIN')];

  router.get('/admin/providers', ...admin, async (_request, response) => {
    const [settings, credenciais] = await Promise.all([
      deps.repository.listSettings(),
      deps.repository.listCredentials(),
    ]);

    response.json({
      providers: PROVIDER_PARAM_PROVIDERS.map((provider) => {
        const enabled = settings.find((linha) => linha.provider === provider)?.enabled ?? true;
        const llmProvider = deps.providers.get(provider);

        const keys = PROVIDER_KEY_SLOTS[provider].map((slot) => {
          const salva = credenciais.find(
            (linha) => linha.provider === provider && linha.kind === slot.kind,
          );
          return {
            kind: slot.kind,
            label: slot.label,
            configured: Boolean(salva),
            // NUNCA a chave em texto puro — só o suficiente para reconhecer QUAL é.
            masked: salva ? maskApiKey(deps.cipher.decrypt(salva.apiKeyCipher)) : null,
            updatedAt: salva?.updatedAt.toISOString() ?? null,
          };
        });

        return {
          provider,
          enabled,
          // O que está DE FATO valendo agora — difere de "tem chave" quando o
          // provider não tem adaptador de geração (OpenAI, Anthropic) ou está
          // desligado.
          available: llmProvider?.available ?? false,
          keys,
          // Só o Gemini distingue gratuita de paga — os outros nunca têm o quê
          // forçar, e a tela usa a ausência do campo para não desenhar a Switch.
          //
          // `tier`/`freeAvailableAt` são o estado VIVO do anel de chaves — o
          // que a PRÓXIMA chamada vai usar —, não o que a última chamada
          // gravada usou. Sem isto, desligar a força depois de UMA chamada
          // forçada deixava a tela presa dizendo "cota gratuita esgotada": o
          // último `ai_calls` tinha saído pela paga (porque foi forçado), a
          // força foi desligada, e a gratuita nunca tinha sido sequer tentada.
          ...(provider === 'gemini' && llmProvider instanceof GeminiProvider
            ? {
                ...(() => {
                  const status = llmProvider.keyStatus();
                  return {
                    forcedPaid: status.forcedPaid,
                    tier: status.tier,
                    freeAvailableAt: status.freeAvailableAt?.toISOString() ?? null,
                  };
                })(),
              }
            : {}),
        };
      }),
    });
  });

  router.patch('/admin/providers/gemini/force-paid', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const body = parseBody(z.object({ forcedPaid: z.boolean() }), request);

    await deps.manage.setGeminiForcedPaid(tenant, { forcedPaid: body.forcedPaid });
    response.status(204).end();
  });

  router.patch('/admin/providers/:provider', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const { provider } = parseParams(providerParam, request);
    const body = parseBody(z.object({ enabled: z.boolean() }), request);

    await deps.manage.setEnabled(tenant, { provider, enabled: body.enabled });
    response.status(204).end();
  });

  router.put('/admin/providers/:provider/keys/:kind', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const { provider, kind } = parseParams(keyParam, request);
    const body = parseBody(z.object({ apiKey: z.string().trim().min(1).max(400) }), request);

    await deps.manage.saveKey(tenant, { provider, kind, apiKey: body.apiKey });
    response.status(204).end();
  });

  router.post(
    '/admin/providers/:provider/keys/:kind/test',
    ...admin,
    async (request, response) => {
      const tenant = requireTenant(request);
      const { provider, kind } = parseParams(keyParam, request);
      const body = parseBody(
        z.object({ apiKey: z.string().trim().max(400).optional() }),
        request,
      );

      response.json(
        await deps.manage.testKey(tenant, {
          provider,
          kind,
          ...(body.apiKey ? { apiKey: body.apiKey } : {}),
        }),
      );
    },
  );

  return router;
}
