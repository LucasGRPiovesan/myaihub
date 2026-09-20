import type { Request, Response } from 'express';
import { createContainer } from './container.js';
import { createApp } from './http/app.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from './modules/myaihub/infrastructure/master-policy.seed.js';
import { PLAYBOOK_SEEDS } from './modules/myaihub/infrastructure/playbooks.seed.js';
import { ensureDatabaseReady } from './shared/infrastructure/prisma/bootstrap.js';

/**
 * Entrypoint da Vercel (Function/Fluid Compute). NÃO chama `app.listen()` —
 * a Vercel entrega a requisição HTTP direto ao handler exportado. O
 * bootstrap (checagem de schema, seed de policy/playbooks, registro de
 * providers) roda UMA vez por instância morna, nunca por requisição:
 * `ready` é montado no escopo do módulo e todo handler espera por ele.
 * `main.ts` continua sendo o entrypoint de dev/produção com servidor próprio
 * — este arquivo não o substitui, só serve à Vercel.
 */
const container = createContainer();

const ready: Promise<void> = (async () => {
  await ensureDatabaseReady(container.db, container.logger);

  await container.hub.policies.syncSections(MASTER_POLICY_NAME, MASTER_POLICY_V1);
  await container.hub.playbooks.seedMissing(PLAYBOOK_SEEDS);

  void container.usage.exchangeRate.warm();
  await container.ai.providerRegistry.load();
  await container.ai.modelRoutes.load();

  try {
    const ultima = await container.usage.read.lastServedTierAnywhere();
    if (ultima) container.ai.servedTier.record(ultima.tier);
  } catch (error) {
    container.logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'não foi possível semear a cota servida; o primeiro turno resolve',
    );
  }
})();

ready.catch((error: unknown) => {
  container.logger.error(
    { err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
    'falha no bootstrap da função Vercel',
  );
});

const app = createApp(container);

export default async function handler(request: Request, response: Response): Promise<void> {
  try {
    await ready;
  } catch (error) {
    response.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message:
          error instanceof Error ? error.message : 'Falha ao inicializar a API. Veja os logs da função.',
      },
    });
    return;
  }

  app(request, response);
}
