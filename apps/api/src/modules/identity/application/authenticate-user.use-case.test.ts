import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/domain/errors.js';
import { AuthenticateUserUseCase } from './authenticate-user.use-case.js';
import {
  FakeAccountRepository,
  FakePasswordHasher,
  FakeRefreshTokenRepository,
  FakeTokenService,
  FakeUserRepository,
  FixedClock,
  REQUEST_INFO,
  SequentialIdGenerator,
  makeAccount,
  makeUser,
} from './identity.fixtures.js';
import { SessionIssuer } from './session-issuer.js';

const PASSWORD = 'Senha@Forte123';

function build(user = makeUser({ passwordHash: `scrypt$${PASSWORD}` })) {
  const users = new FakeUserRepository([user]);
  const accounts = FakeAccountRepository.withOwner(user.id, makeAccount());
  const refreshTokens = new FakeRefreshTokenRepository();
  const hasher = new FakePasswordHasher();
  const clock = new FixedClock();
  const sessions = new SessionIssuer(
    accounts,
    refreshTokens,
    new FakeTokenService(clock),
    new SequentialIdGenerator(),
    clock,
  );

  return {
    useCase: new AuthenticateUserUseCase(users, accounts, hasher, sessions, clock),
    users,
    accounts,
    hasher,
    clock,
    user,
  };
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

describe('AuthenticateUserUseCase', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('emite sessão para credenciais válidas', async () => {
    const session = await context.useCase.execute(
      { email: 'lucas@exemplo.com', password: PASSWORD },
      REQUEST_INFO,
    );

    expect(session.user.email).toBe('lucas@exemplo.com');
    expect(session.user.activeAccount.membershipRole).toBe('OWNER');
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
  });

  it('registra o login', async () => {
    await context.useCase.execute({ email: 'lucas@exemplo.com', password: PASSWORD }, REQUEST_INFO);
    expect(context.users.logins).toEqual([context.user.id]);
  });

  it('rejeita senha incorreta', async () => {
    const error = await expectAppError(
      context.useCase.execute({ email: 'lucas@exemplo.com', password: 'errada' }, REQUEST_INFO),
    );
    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.httpStatus).toBe(401);
  });

  it('rejeita e-mail inexistente com o MESMO código e mensagem', async () => {
    const wrongPassword = await expectAppError(
      context.useCase.execute({ email: 'lucas@exemplo.com', password: 'errada' }, REQUEST_INFO),
    );
    const unknownEmail = await expectAppError(
      context.useCase.execute({ email: 'ninguem@exemplo.com', password: 'errada' }, REQUEST_INFO),
    );

    expect(unknownEmail.code).toBe(wrongPassword.code);
    expect(unknownEmail.message).toBe(wrongPassword.message);
  });

  it('gasta trabalho de verificação mesmo para e-mail inexistente', async () => {
    // Sem isto, a resposta para e-mail desconhecido volta em microssegundos e a
    // diferença de tempo enumera quem está cadastrado.
    await expectAppError(
      context.useCase.execute({ email: 'ninguem@exemplo.com', password: 'x' }, REQUEST_INFO),
    );

    expect(context.hasher.verifyCalls).toHaveLength(1);
    expect(context.hasher.verifyCalls[0]?.hash).toMatch(/^scrypt\$/);
  });

  it('recusa usuário desativado', async () => {
    const disabled = build(makeUser({ status: 'DISABLED', passwordHash: `scrypt$${PASSWORD}` }));
    const error = await expectAppError(
      disabled.useCase.execute({ email: 'lucas@exemplo.com', password: PASSWORD }, REQUEST_INFO),
    );

    expect(error.code).toBe('ACCOUNT_INACTIVE');
    expect(error.httpStatus).toBe(403);
  });

  it('recusa quando não há conta ativa', async () => {
    context.accounts.revokeMemberships(context.user.id);
    const error = await expectAppError(
      context.useCase.execute({ email: 'lucas@exemplo.com', password: PASSWORD }, REQUEST_INFO),
    );

    expect(error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('reidrata o hash quando os parâmetros de custo mudaram', async () => {
    context.hasher.needsRehashResult = true;
    await context.useCase.execute({ email: 'lucas@exemplo.com', password: PASSWORD }, REQUEST_INFO);

    expect(context.users.rehashed).toEqual([context.user.id]);
  });

  it('não reidrata quando o hash já está atualizado', async () => {
    await context.useCase.execute({ email: 'lucas@exemplo.com', password: PASSWORD }, REQUEST_INFO);
    expect(context.users.rehashed).toEqual([]);
  });
});
