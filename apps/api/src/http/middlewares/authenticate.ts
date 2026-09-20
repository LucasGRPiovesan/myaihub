import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRole } from '@myaihub/shared';
import type { TokenService } from '../../shared/application/ports.js';
import {
  runWithTenantContext,
  type TenantContext,
} from '../../shared/application/tenant-context.js';
import { ForbiddenError, UnauthenticatedError } from '../../shared/domain/errors.js';
import { ACCESS_COOKIE } from '../cookies.js';

function extractToken(request: Request): string | null {
  const cookieToken = request.cookies?.[ACCESS_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

  // Bearer é aceito para clientes que não são o app web (testes, integrações).
  const header = request.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return null;
}

/**
 * Autentica e estabelece o TenantContext da requisição.
 *
 * O contexto é publicado de duas formas, deliberadamente:
 *   - `request.tenant`, passado EXPLICITAMENTE aos use cases (regra primária);
 *   - AsyncLocalStorage, consumido pelo tenantGuard do Prisma (rede de segurança).
 *
 * Ver docs/ARCHITECTURE.md §12.
 */
export function authenticate(tokens: TokenService): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const token = extractToken(request);
    if (!token) {
      next(new UnauthenticatedError());
      return;
    }

    tokens
      .verifyAccessToken(token)
      .then((claims) => {
        const context: TenantContext = {
          accountId: claims.accountId,
          userId: claims.userId,
          role: claims.role as UserRole,
          membershipRole: null,
          elevated: false,
        };

        request.auth = {
          userId: claims.userId,
          accountId: claims.accountId,
          role: claims.role,
          sessionId: claims.sessionId,
        };
        request.tenant = context;
        request.log = request.log.child({ userId: claims.userId, accountId: claims.accountId });

        runWithTenantContext(context, () => next());
      })
      .catch(next);
  };
}

/** RBAC. Ver docs/ARCHITECTURE.md §48. */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const role = request.auth?.role;
    if (!role) {
      next(new UnauthenticatedError());
      return;
    }
    if (!allowed.includes(role as UserRole)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

export function requireTenant(request: Request): TenantContext {
  if (!request.tenant) {
    throw new UnauthenticatedError();
  }
  return request.tenant;
}

export function requireAuth(request: Request): NonNullable<Request['auth']> {
  if (!request.auth) {
    throw new UnauthenticatedError();
  }
  return request.auth;
}
