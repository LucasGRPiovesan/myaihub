import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/domain/errors.js';
import { GetCurrentUserUseCase } from './get-current-user.use-case.js';
import {
  FakeAccountRepository,
  FakeUserRepository,
  makeAccount,
  makeUser,
} from './identity.fixtures.js';

const ACCOUNT = makeAccount();

function build(user = makeUser()) {
  const users = new FakeUserRepository([user]);
  const accounts = FakeAccountRepository.withOwner(user.id, ACCOUNT);
  return { useCase: new GetCurrentUserUseCase(users, accounts), users, accounts, user };
}

async function expectAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('esperava um AppError, mas a promise resolveu');
}

describe('GetCurrentUserUseCase', () => {
  it('devolve o usuário e a conta ativa do token', async () => {
    const { useCase, user } = build();
    const result = await useCase.execute(user.id, ACCOUNT.id);

    expect(result.email).toBe(user.email);
    expect(result.activeAccount.id).toBe(ACCOUNT.id);
    expect(result.accounts).toHaveLength(1);
  });

  it('invalida a sessão quando o vínculo com a conta do token foi revogado', async () => {
    const { useCase, accounts, user } = build();
    accounts.revokeMemberships(user.id);

    const error = await expectAppError(useCase.execute(user.id, ACCOUNT.id));
    expect(error.httpStatus).toBe(401);
  });

  it('NÃO cai silenciosamente para outra conta quando o token aponta para uma inacessível', async () => {
    // O TenantContext continua escopado ao accountId do token. Devolver outra
    // conta faria a UI mostrar A enquanto a API opera sobre B.
    const { useCase, user } = build();

    const error = await expectAppError(useCase.execute(user.id, '01OUTRACONTA0000000000000'));

    expect(error.httpStatus).toBe(401);
    expect(error.code).toBe('TOKEN_INVALID');
  });

  it('rejeita usuário desativado', async () => {
    const { useCase, user } = build(makeUser({ status: 'DISABLED' }));
    const error = await expectAppError(useCase.execute(user.id, ACCOUNT.id));
    expect(error.httpStatus).toBe(401);
  });

  it('rejeita usuário inexistente', async () => {
    const { useCase } = build();
    const error = await expectAppError(useCase.execute('id-que-nao-existe', ACCOUNT.id));
    expect(error.httpStatus).toBe(401);
  });
});
