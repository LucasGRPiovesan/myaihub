import type { Clock } from '../../../shared/application/ports.js';
import type { RefreshTokenRepository } from '../domain/repositories.js';
import { hashToken } from './session-issuer.js';

export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Encerra a sessão. Idempotente por design: um logout com token já inválido
   * não é erro — o resultado desejado (sessão encerrada) já vale.
   */
  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    const stored = await this.refreshTokens.findByHash(hashToken(refreshToken));
    if (!stored || stored.revokedAt) return;

    await this.refreshTokens.revokeSession(stored.sessionId, this.clock.now());
  }
}
