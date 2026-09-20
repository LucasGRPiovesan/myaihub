import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/domain/errors.js';
import {
  FakeAccountRepository,
  FakeRefreshTokenRepository,
  FakeTokenService,
  FakeUserRepository,
  FixedClock,
  REQUEST_INFO,
  RecordingLogger,
  SequentialIdGenerator,
  makeAccount,
  makeUser,
} from './identity.fixtures.js';
import { RefreshSessionUseCase } from './refresh-session.use-case.js';
import { SessionIssuer } from './session-issuer.js';

function build() {
  const user = makeUser();
  const users = new FakeUserRepository([user]);
  const accounts = FakeAccountRepository.withOwner(user.id, makeAccount());
  const refreshTokens = new FakeRefreshTokenRepository();
  const clock = new FixedClock();
  const tokens = new FakeTokenService(clock);
  const logger = new RecordingLogger();
  const sessions = new SessionIssuer(
    accounts,
    refreshTokens,
    tokens,
    new SequentialIdGenerator(),
    clock,
  );

  return {
    useCase: new RefreshSessionUseCase(refreshTokens, users, tokens, sessions, clock, logger),
    sessions,
    refreshTokens,
    accounts,
    users,
    clock,
    logger,
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

describe('RefreshSessionUseCase', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  async function startSession() {
    return context.sessions.issue(context.user, makeAccount().id, REQUEST_INFO);
  }

  it('rotaciona o refresh token e preserva a sessão', async () => {
    const first = await startSession();
    const renewed = await context.useCase.execute(first.refreshToken, REQUEST_INFO);

    expect(renewed.refreshToken).not.toBe(first.refreshToken);
    expect(renewed.sessionId).toBe(first.sessionId);
    expect(context.refreshTokens.activeCount).toBe(1);
  });

  it('revoga TODAS as sessões ao detectar reuso de um token já rotacionado', async () => {
    const first = await startSession();
    const second = await startSession(); // outra sessão do mesmo usuário
    await context.useCase.execute(first.refreshToken, REQUEST_INFO);

    const error = await expectAppError(context.useCase.execute(first.refreshToken, REQUEST_INFO));

    expect(error.code).toBe('TOKEN_INVALID');
    // Um token vazado compromete o usuário, não só aquela sessão.
    expect(context.refreshTokens.activeCount).toBe(0);
    expect(second.sessionId).toBeTruthy();
    expect(context.logger.entries.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('rejeita token expirado', async () => {
    const first = await startSession();
    context.clock.advance(31 * 86400 * 1000);

    const error = await expectAppError(context.useCase.execute(first.refreshToken, REQUEST_INFO));
    expect(error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejeita token desconhecido pelo banco', async () => {
    const error = await expectAppError(
      context.useCase.execute('refresh:inexistente', REQUEST_INFO),
    );
    expect(error.code).toBe('TOKEN_INVALID');
  });

  it('derruba a sessão quando o usuário é desativado', async () => {
    const first = await startSession();
    context.user.status = 'DISABLED';

    const error = await expectAppError(context.useCase.execute(first.refreshToken, REQUEST_INFO));

    expect(error.code).toBe('TOKEN_INVALID');
    expect(context.refreshTokens.activeCount).toBe(0);
  });

  it('devolve 401 — e não 500 — quando o vínculo com a conta foi revogado', async () => {
    const first = await startSession();
    context.accounts.revokeMemberships(context.user.id);

    const error = await expectAppError(context.useCase.execute(first.refreshToken, REQUEST_INFO));

    expect(error.code).toBe('TOKEN_INVALID');
    expect(error.httpStatus).toBe(401);
  });

  it('permite renovações sucessivas', async () => {
    let current = await startSession();
    for (let i = 0; i < 3; i += 1) {
      current = await context.useCase.execute(current.refreshToken, REQUEST_INFO);
    }
    expect(context.refreshTokens.activeCount).toBe(1);
  });
});
