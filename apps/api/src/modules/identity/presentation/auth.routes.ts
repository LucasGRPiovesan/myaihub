import {
  loginRequestSchema,
  paginationQuerySchema,
  registerRequestSchema,
  type AuthSessionResponse,
} from '@myaihub/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '../../../http/cookies.js';
import {
  authenticate,
  requireAuth,
  requireTenant,
} from '../../../http/middlewares/authenticate.js';
import { authRateLimit } from '../../../http/middlewares/rate-limit.js';
import { parseBody, parseParams, parseQuery } from '../../../http/validate.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { TokenService } from '../../../shared/application/ports.js';
import type { AuthenticateUserUseCase } from '../application/authenticate-user.use-case.js';
import type { GetCurrentUserUseCase } from '../application/get-current-user.use-case.js';
import type { ListAccountAuditLogsUseCase } from '../application/list-account-audit-logs.use-case.js';
import type { LogoutUseCase } from '../application/logout.use-case.js';
import type { RefreshSessionUseCase } from '../application/refresh-session.use-case.js';
import type { RegisterUserUseCase } from '../application/register-user.use-case.js';
import type { IssuedSession, SessionRequestInfo } from '../application/session-issuer.js';

export interface AuthRouterDependencies {
  registerUser: RegisterUserUseCase;
  authenticateUser: AuthenticateUserUseCase;
  refreshSession: RefreshSessionUseCase;
  logout: LogoutUseCase;
  getCurrentUser: GetCurrentUserUseCase;
  listAccountAuditLogs: ListAccountAuditLogsUseCase;
  tokens: TokenService;
}

function requestInfo(request: Request): SessionRequestInfo {
  return {
    userAgent: request.header('user-agent')?.slice(0, 400) ?? null,
    ip: request.ip ?? null,
  };
}

function respondWithSession(response: Response, session: IssuedSession, status = 200): void {
  setAuthCookies(response, session);

  const body: AuthSessionResponse = {
    user: session.user,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
  };

  response.status(status).json(body);
}

const accountParamsSchema = z.object({
  accountId: z.string().length(26, 'Identificador inválido.'),
});

export function createAuthRouter(deps: AuthRouterDependencies): Router {
  const router = Router();

  router.post('/auth/register', authRateLimit, async (request, response) => {
    const input = parseBody(registerRequestSchema, request);
    const session = await deps.registerUser.execute(input, requestInfo(request));
    respondWithSession(response, session, 201);
  });

  router.post('/auth/login', authRateLimit, async (request, response) => {
    const input = parseBody(loginRequestSchema, request);
    const session = await deps.authenticateUser.execute(input, requestInfo(request));
    respondWithSession(response, session);
  });

  router.post('/auth/refresh', authRateLimit, async (request, response) => {
    const token: unknown = request.cookies?.[REFRESH_COOKIE] ?? request.body?.refreshToken;
    if (typeof token !== 'string' || !token) {
      throw new UnauthenticatedError('TOKEN_INVALID', 'Sessão ausente.');
    }
    const session = await deps.refreshSession.execute(token, requestInfo(request));
    respondWithSession(response, session);
  });

  router.post('/auth/logout', async (request, response) => {
    const token: unknown = request.cookies?.[REFRESH_COOKIE];
    await deps.logout.execute(typeof token === 'string' ? token : undefined);
    clearAuthCookies(response);
    response.status(204).end();
  });

  router.get('/auth/me', authenticate(deps.tokens), async (request, response) => {
    const auth = requireAuth(request);
    const user = await deps.getCurrentUser.execute(auth.userId, auth.accountId);
    response.json({ user });
  });

  /**
   * Auditoria da conta. É o primeiro recurso tenant-scoped do sistema e serve
   * como prova viva dos Flows 7 e 8 (§72):
   *   - conta própria           → ok
   *   - ADMIN + X-Elevation-Reason em outra conta → ok, auditado
   *   - USER em outra conta     → 404
   */
  router.get(
    '/accounts/:accountId/audit-logs',
    authenticate(deps.tokens),
    async (request, response) => {
      const tenant = requireTenant(request);
      const { accountId } = parseParams(accountParamsSchema, request);
      const { limit, cursor } = parseQuery(paginationQuerySchema, request);
      const reason = request.header('x-elevation-reason');

      const items = await deps.listAccountAuditLogs.execute(tenant, {
        targetAccountId: accountId,
        limit,
        cursor: cursor ?? null,
        ...(reason ? { reason } : {}),
      });

      response.json({
        items,
        nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null,
      });
    },
  );

  return router;
}

export const COOKIE_NAMES = { ACCESS_COOKIE, REFRESH_COOKIE };
