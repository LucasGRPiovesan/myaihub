import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../domain/errors.js';
import {
  assertTenantAccess,
  elevateScope,
  getCurrentTenantContext,
  publicTenantContext,
  runWithTenantContext,
  systemTenantContext,
  type TenantContext,
} from './tenant-context.js';

const ACCOUNT_A = '01ACCOUNT00000000000000AA';
const ACCOUNT_B = '01ACCOUNT00000000000000BB';

function context(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    accountId: ACCOUNT_A,
    userId: '01USER0000000000000000000',
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
    ...overrides,
  };
}

describe('elevateScope', () => {
  it('permite a um ADMIN alcançar outro tenant com motivo declarado', () => {
    const elevated = elevateScope(context({ role: 'ADMIN' }), ACCOUNT_B, 'suporte #123');

    expect(elevated.accountId).toBe(ACCOUNT_B);
    expect(elevated.elevated).toBe(true);
    expect(elevated.reason).toBe('suporte #123');
    // O ator é preservado — sem isso a auditoria não sabe quem elevou.
    expect(elevated.userId).toBe(context().userId);
  });

  it('recusa elevação para USER', () => {
    expect(() => elevateScope(context(), ACCOUNT_B, 'quero ver')).toThrow(ForbiddenError);
  });

  it('recusa elevação sem motivo', () => {
    expect(() => elevateScope(context({ role: 'ADMIN' }), ACCOUNT_B, '')).toThrow(ForbiddenError);
    expect(() => elevateScope(context({ role: 'ADMIN' }), ACCOUNT_B, '   ')).toThrow(
      ForbiddenError,
    );
  });

  it('não herda o papel de membership da conta de origem', () => {
    const elevated = elevateScope(context({ role: 'ADMIN' }), ACCOUNT_B, 'motivo');
    expect(elevated.membershipRole).toBeNull();
  });
});

describe('assertTenantAccess', () => {
  it('permite acesso à própria conta', () => {
    expect(() => assertTenantAccess(context(), ACCOUNT_A)).not.toThrow();
  });

  it('bloqueia acesso a conta alheia', () => {
    expect(() => assertTenantAccess(context(), ACCOUNT_B)).toThrow(ForbiddenError);
  });

  it('libera quando o contexto está elevado', () => {
    const elevated = elevateScope(context({ role: 'ADMIN' }), ACCOUNT_B, 'motivo');
    expect(() => assertTenantAccess(elevated, ACCOUNT_B)).not.toThrow();
  });

  it('não libera conta alheia só porque o papel é ADMIN, sem elevação', () => {
    // Privilégio de ADMIN não é passe livre implícito: exige elevação auditada.
    expect(() => assertTenantAccess(context({ role: 'ADMIN' }), ACCOUNT_B)).toThrow(ForbiddenError);
  });
});

describe('propagação do contexto', () => {
  it('expõe o contexto ativo dentro do escopo e não fora dele', () => {
    expect(getCurrentTenantContext()).toBeUndefined();

    runWithTenantContext(context(), () => {
      expect(getCurrentTenantContext()?.accountId).toBe(ACCOUNT_A);
    });

    expect(getCurrentTenantContext()).toBeUndefined();
  });

  it('propaga por continuações assíncronas', async () => {
    await runWithTenantContext(context(), async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getCurrentTenantContext()?.accountId).toBe(ACCOUNT_A);
    });
  });

  it('mantém escopos aninhados isolados', () => {
    runWithTenantContext(context(), () => {
      runWithTenantContext(context({ accountId: ACCOUNT_B }), () => {
        expect(getCurrentTenantContext()?.accountId).toBe(ACCOUNT_B);
      });
      expect(getCurrentTenantContext()?.accountId).toBe(ACCOUNT_A);
    });
  });
});

describe('contextos especiais', () => {
  it('o contexto de sistema é elevado e exige motivo', () => {
    const system = systemTenantContext('seed');
    expect(system.elevated).toBe(true);
    expect(system.reason).toBe('seed');
    expect(system.role).toBe('SYSTEM');
  });

  it('o contexto do public chat tem tenant mas NÃO é elevado', () => {
    // O accountId vem do publicId resolvido no servidor, nunca do request.
    const publicContext = publicTenantContext(ACCOUNT_A);
    expect(publicContext.accountId).toBe(ACCOUNT_A);
    expect(publicContext.elevated).toBe(false);
    expect(publicContext.userId).toBeNull();
  });

  it('o public chat não alcança outra conta', () => {
    expect(() => assertTenantAccess(publicTenantContext(ACCOUNT_A), ACCOUNT_B)).toThrow(
      ForbiddenError,
    );
  });
});

/**
 * A elevação sobrevive a um callback SÍNCRONO que devolve promessa.
 *
 * `AsyncLocalStorage.run` restaura o escopo anterior assim que `fn` retorna, e
 * o Prisma só dispara a consulta quando a promessa é aguardada. Com
 * `runWithTenantContext(ctx, () => db.algo.findFirst())` a consulta saía depois
 * de o escopo ter fechado e o guard via contexto vazio — a elevação sumia sem
 * aviso, numa chamada que parece correta. Havia cinco call sites com essa forma.
 */
describe('o escopo sobrevive à promessa', () => {
  it('mantém o contexto até a promessa assentar, com callback síncrono', async () => {
    const alvo = context({ accountId: ACCOUNT_A });

    // Sem `async` no callback: é a forma que perdia o contexto.
    const visto = await runWithTenantContext(alvo, () =>
      Promise.resolve().then(() => getCurrentTenantContext()?.accountId),
    );

    expect(visto).toBe(ACCOUNT_A);
  });

  it('continua funcionando com callback assíncrono', async () => {
    const alvo = context({ accountId: ACCOUNT_A });

    const visto = await runWithTenantContext(alvo, async () => {
      await Promise.resolve();
      return getCurrentTenantContext()?.accountId;
    });

    expect(visto).toBe(ACCOUNT_A);
  });

  it('não vaza para fora', async () => {
    await runWithTenantContext(context({ accountId: ACCOUNT_A }), () => Promise.resolve());

    expect(getCurrentTenantContext()).toBeUndefined();
  });
});
