import type { AccountSummary, AuthenticatedUser } from '@myaihub/shared';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { AccountRepository, UserRepository } from '../domain/repositories.js';

export class GetCurrentUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(userId: string, activeAccountId: string): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError();
    }

    const memberships = await this.accounts.listForUser(userId);
    const summaries: AccountSummary[] = memberships.map((item) => ({
      id: item.account.id,
      name: item.account.name,
      slug: item.account.slug,
      membershipRole: item.membershipRole,
    }));

    // Nada de cair para outra conta quando o vínculo com a do token sumiu.
    // O TenantContext continua escopado ao accountId do token, então devolver
    // outra conta faria a UI mostrar A enquanto a API opera sobre B — e o
    // usuário veria dados de uma conta achando que está em outra.
    // Vínculo revogado invalida a sessão; o cliente reautentica.
    const active = summaries.find((item) => item.id === activeAccountId);
    if (!active) {
      throw new UnauthenticatedError(
        'TOKEN_INVALID',
        'Seu acesso a esta conta mudou. Entre novamente.',
      );
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      activeAccount: active,
      accounts: summaries,
    };
  }
}
