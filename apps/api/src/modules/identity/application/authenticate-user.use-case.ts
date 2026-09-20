import type { LoginRequest } from '@myaihub/shared';
import type { Clock, PasswordHasher } from '../../../shared/application/ports.js';
import { ForbiddenError, UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { AccountRepository, UserRepository } from '../domain/repositories.js';
import type { IssuedSession, SessionIssuer, SessionRequestInfo } from './session-issuer.js';

/**
 * Hash descartável usado quando o e-mail não existe.
 *
 * Sem isto, a resposta para e-mail inexistente volta em microssegundos e a
 * resposta para senha errada leva ~100ms — o que enumera usuários por timing.
 * Verificamos contra um hash real para gastar o mesmo trabalho nos dois casos.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'ZHVtbXktaGFzaC1wYXJhLW5vcm1hbGl6YXItdGltaW5nLW5hby1lLXVtLXNlZ3JlZG8tcmVhbC0wMDAwMDAwMA';

export class AuthenticateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(input: LoginRequest, request: SessionRequestInfo): Promise<IssuedSession> {
    const user = await this.users.findByEmail(input.email);

    const passwordMatches = await this.hasher.verify(
      input.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !passwordMatches) {
      throw new UnauthenticatedError('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('ACCOUNT_INACTIVE', 'Esta conta está desativada.');
    }

    const memberships = await this.accounts.listForUser(user.id);
    const active = memberships.find((item) => item.account.status === 'ACTIVE');

    if (!active) {
      throw new ForbiddenError('ACCOUNT_INACTIVE', 'Nenhuma conta ativa disponível.');
    }

    // Reidrata o hash quando os parâmetros de custo evoluírem.
    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await this.hasher.hash(input.password));
    }

    await this.users.registerLogin(user.id, this.clock.now());

    return this.sessions.issue(user, active.account.id, request);
  }
}
