import type { RegisterRequest } from '@myaihub/shared';
import type { IdGenerator, PasswordHasher } from '../../../shared/application/ports.js';
import { ConflictError } from '../../../shared/domain/errors.js';
import type { RegistrationRepository, UserRepository } from '../domain/repositories.js';
import { defaultAccountName, slugify } from '../domain/types.js';
import type { IssuedSession, SessionRequestInfo } from './session-issuer.js';
import type { SessionIssuer } from './session-issuer.js';

/**
 * Cadastro de usuário.
 *
 * Todo usuário nasce dono da própria Account — é o que torna o sistema
 * multi-tenant desde o primeiro cadastro, sem caso especial (§47).
 */
export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly registrations: RegistrationRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: RegisterRequest, request: SessionRequestInfo): Promise<IssuedSession> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('EMAIL_ALREADY_IN_USE', 'Este e-mail já está cadastrado.');
    }

    const accountName = input.accountName?.trim() || defaultAccountName(input.name);
    const passwordHash = await this.hasher.hash(input.password);

    // Os ids são gerados aqui, não no banco: é o que permite montar a entrada de
    // auditoria antes da transação e gravá-la DENTRO dela.
    const userId = this.ids.generate();
    const accountId = this.ids.generate();

    const created = await this.registrations.createUserWithAccount({
      user: {
        id: userId,
        name: input.name.trim(),
        email: input.email,
        passwordHash,
      },
      account: {
        id: accountId,
        name: accountName,
        slugBase: slugify(accountName),
      },
      membership: {
        id: this.ids.generate(),
        role: 'OWNER',
      },
      audit: {
        accountId,
        actorUserId: userId,
        action: 'account.created',
        entityType: 'Account',
        entityId: accountId,
        metadata: { accountName },
      },
    });

    return this.sessions.issue(created.user, created.account.id, request);
  }
}
