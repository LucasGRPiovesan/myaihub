import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from '../config/env.js';
import type { Container } from '../container.js';
import { createAuthRouter } from '../modules/identity/presentation/auth.routes.js';
import { createAgentsRouter } from '../modules/agents/presentation/agents.routes.js';
import { createCampaignsRouter } from '../modules/campaigns/presentation/campaigns.routes.js';
import { createMediaRouter } from '../modules/media/presentation/media.routes.js';
import { createHubRouter } from '../modules/myaihub/presentation/hub.routes.js';
import { createManualEditRouter } from '../modules/myaihub/presentation/manual-edit.routes.js';
import { createPublicChatRouter } from '../modules/campaigns/presentation/public-chat.routes.js';
import { createProjectsRouter } from '../modules/projects/presentation/projects.routes.js';
import { createProjectAssetsRouter } from '../modules/projects/presentation/project-assets.routes.js';
import { createConversationsRouter } from '../modules/conversations/presentation/conversations.routes.js';
import { createMetricsRouter } from '../modules/metrics/presentation/metrics.routes.js';
import { createModelsRouter } from '../modules/ai/presentation/models.routes.js';
import { createProviderCredentialsRouter } from '../modules/ai/presentation/provider-credentials.routes.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { createAdminRouter } from '../modules/myaihub/presentation/admin.routes.js';
import { generalRateLimit } from './middlewares/rate-limit.js';
import { accessLog } from './middlewares/access-log.js';
import { requestContext } from './middlewares/request-context.js';

export function createApp(container: Container): Express {
  const app = express();

  // Necessário para que request.ip reflita o cliente atrás de proxy/load balancer.
  // 1 = confia apenas no primeiro proxy; confiar em todos permitiria falsificar IP
  // e furar o rate limit.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // A API não serve HTML; CSP fica com o app web (e com o Public Chat).
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Elevation-Reason'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // Corpo maior só nas DUAS rotas que aceitam imagem inline do cliente (Lab e
  // chat público, §ver `inline-images.ts`) — imagem em base64 infla ~37% e
  // não cabe no limite padrão. O limite continua apertado em toda outra rota:
  // um segundo `express.json` com limite maior DEPOIS do global não ajudaria
  // (o primeiro já teria consumido/rejeitado o stream), então a escolha do
  // limite é feita ANTES de qualquer parser rodar, por padrão de caminho.
  const defaultJsonParser = express.json({ limit: '1mb' });
  const labImageJsonParser = express.json({ limit: '25mb' });
  const publicChatImageJsonParser = express.json({ limit: '8mb' });

  app.use((request, response, next) => {
    if (/^\/api\/agents\/[^/]+\/test$/.test(request.path)) {
      return labImageJsonParser(request, response, next);
    }
    if (/^\/api\/public\/[^/]+\/messages$/.test(request.path)) {
      return publicChatImageJsonParser(request, response, next);
    }
    return defaultJsonParser(request, response, next);
  });
  app.use(cookieParser());
  app.use(requestContext(container.logger));
  // Depois do requestContext: é ele que gera o `requestId` que a linha carrega.
  app.use(accessLog(container.logger));
  app.use(generalRateLimit);

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'myaihub-api', env: env.NODE_ENV });
  });

  app.get('/api/health/db', async (_request, response) => {
    await container.db.account.count({ where: { id: '__healthcheck__' } });
    response.json({ status: 'ok', database: 'reachable' });
  });

  app.use('/api', createAuthRouter(container.identity));
  app.use('/api', createProjectsRouter(container.projects));
  app.use('/api', createProjectAssetsRouter(container.projectAssets));
  app.use('/api', createConversationsRouter(container.conversations));
  app.use('/api', createMetricsRouter(container.metrics));
  app.use('/api', createModelsRouter(container.models));
  app.use('/api', createProviderCredentialsRouter(container.providerCredentials));
  app.use('/api', createAgentsRouter(container.agents));
  app.use('/api', createCampaignsRouter(container.campaigns));
  app.use('/api', createMediaRouter(container.media));
  app.use('/api', createHubRouter(container.hub));
  app.use('/api', createManualEditRouter(container.manualEdit));
  app.use('/api', createAdminRouter(container.admin));
  // SEM autenticação, de propósito: é o chat que o público usa. O tenant sai do
  // `publicId`, dentro do use case — nunca do request.
  app.use('/api', createPublicChatRouter(container.publicChat));

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
