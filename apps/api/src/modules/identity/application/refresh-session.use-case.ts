import type { Clock, Logger, TokenService } from '../../../shared/application/ports.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { RefreshTokenRepository, UserRepository } from '../domain/repositories.js';
import {
  hashToken,
  type IssuedSession,
  type SessionIssuer,
  type SessionRequestInfo,
} from './session-issuer.js';

/**
 * Renova a sessão rotacionando o refresh token.
 *
 * Detecção de reuso: se chega um refresh token que já foi rotacionado ou
 * revogado, isso significa que alguém está usando uma cópia — o token vazou.
 * A resposta é revogar TODAS as sessões do usuário, não só aquela.
 */
export class RefreshSessionUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(refreshToken: string, request: SessionRequestInfo): Promise<IssuedSession> {
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    const stored = await this.refreshTokens.findByHash(hashToken(refreshToken));

    if (!stored) {
      throw new UnauthenticatedError('TOKEN_INVALID', 'Sessão inválida.');
    }

    const now = this.clock.now();

    if (stored.revokedAt || stored.replacedById) {
      this.logger.warn(
        { userId: stored.userId, sessionId: stored.sessionId },
        'reuso de refresh token detectado — revogando todas as sessões do usuário',
      );
      await this.refreshTokens.revokeAllForUser(stored.userId, now);
      throw new UnauthenticatedError('TOKEN_INVALID', 'Sessão inválida. Entre novamente.');
    }

    if (stored.expiresAt <= now) {
      throw new UnauthenticatedError('TOKEN_EXPIRED', 'Sessão expirada.');
    }

    // Consistência entre o que o token afirma e o que o banco registra.
    if (stored.userId !== claims.userId || stored.sessionId !== claims.sessionId) {
      await this.refreshTokens.revokeSession(stored.sessionId, now);
      throw new UnauthenticatedError('TOKEN_INVALID', 'Sessão inválida.');
    }

    const user = await this.users.findById(stored.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.refreshTokens.revokeAllForUser(stored.userId, now);
      throw new UnauthenticatedError('TOKEN_INVALID', 'Sessão inválida.');
    }

    return this.sessions.issue(user, stored.accountId, request, {
      sessionId: stored.sessionId,
      rotateFromTokenId: stored.id,
    });
  }
}
