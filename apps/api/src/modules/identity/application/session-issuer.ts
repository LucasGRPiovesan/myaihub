import { createHash } from 'node:crypto';
import type { AccountSummary, AuthenticatedUser } from '@myaihub/shared';
import type { Clock, IdGenerator, TokenService } from '../../../shared/application/ports.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { AccountRepository, RefreshTokenRepository } from '../domain/repositories.js';
import type { AccountWithMembership, UserRecord } from '../domain/types.js';

export interface SessionRequestInfo {
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedSession {
  user: AuthenticatedUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

/** O banco guarda apenas o hash do refresh token — o valor em claro nunca é persistido. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toSummary(item: AccountWithMembership): AccountSummary {
  return {
    id: item.account.id,
    name: item.account.name,
    slug: item.account.slug,
    membershipRole: item.membershipRole,
  };
}

/**
 * Emite uma sessão (access + refresh) para um usuário numa conta.
 *
 * Serviço de aplicação compartilhado por register, login e refresh — a lógica de
 * emissão vive num lugar só, senão cada fluxo inventa o seu.
 */
export class SessionIssuer {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async issue(
    user: UserRecord,
    activeAccountId: string,
    request: SessionRequestInfo,
    options: { sessionId?: string; rotateFromTokenId?: string } = {},
  ): Promise<IssuedSession> {
    const memberships = await this.accounts.listForUser(user.id);
    const active = memberships.find((item) => item.account.id === activeAccountId);

    if (!active) {
      // Alcançável de verdade: o vínculo pode ter sido revogado entre o login e
      // a renovação da sessão. Isso é 401 (reautentique), não 500.
      throw new UnauthenticatedError(
        'TOKEN_INVALID',
        'Seu acesso a esta conta mudou. Entre novamente.',
      );
    }

    const sessionId = options.sessionId ?? this.ids.generate();
    const tokenId = this.ids.generate();

    const access = await this.tokens.issueAccessToken({
      userId: user.id,
      accountId: active.account.id,
      role: user.role,
      sessionId,
    });

    const refresh = await this.tokens.issueRefreshToken({
      userId: user.id,
      sessionId,
      tokenId,
    });

    const record = {
      id: tokenId,
      sessionId,
      userId: user.id,
      accountId: active.account.id,
      tokenHash: hashToken(refresh.token),
      expiresAt: refresh.expiresAt,
      userAgent: request.userAgent,
      ip: request.ip,
    };

    if (options.rotateFromTokenId) {
      await this.refreshTokens.rotate(options.rotateFromTokenId, record, this.clock.now());
    } else {
      await this.refreshTokens.create(record);
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        activeAccount: toSummary(active),
        accounts: memberships.map(toSummary),
      },
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      sessionId,
    };
  }
}
