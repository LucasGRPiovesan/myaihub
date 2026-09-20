import type { MembershipRole } from '@myaihub/shared';
import type {
  AccessTokenClaims,
  Clock,
  IdGenerator,
  IssuedToken,
  LogFields,
  Logger,
  PasswordHasher,
  RefreshTokenClaims,
  TokenService,
} from '../../../shared/application/ports.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type {
  AccountRepository,
  IssueRefreshTokenInput,
  RefreshTokenRepository,
  UserRepository,
} from '../domain/repositories.js';
import type {
  AccountRecord,
  AccountWithMembership,
  RefreshTokenRecord,
  UserRecord,
} from '../domain/types.js';

/**
 * Dublês para os testes unitários de use case.
 *
 * Excluídos do build por `tsconfig.json` — nunca vão para `dist/`.
 * Nenhum deles toca banco: estes testes verificam DECISÃO, não persistência;
 * persistência é coberta pelos testes de integração.
 */

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: '01USER0000000000000000000',
    name: 'Lucas Piovesan',
    email: 'lucas@exemplo.com',
    passwordHash: 'scrypt$hash-valido',
    role: 'USER',
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: '01ACCOUNT000000000000000A',
    name: 'Conta de Lucas',
    slug: 'conta-de-lucas',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export class FakeUserRepository implements UserRepository {
  readonly rehashed: string[] = [];
  readonly logins: string[] = [];

  constructor(private users: UserRecord[] = []) {}

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.email === email.toLowerCase()) ?? null;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    this.rehashed.push(userId);
    const user = this.users.find((item) => item.id === userId);
    if (user) user.passwordHash = passwordHash;
  }

  async registerLogin(userId: string): Promise<void> {
    this.logins.push(userId);
  }
}

export class FakeAccountRepository implements AccountRepository {
  constructor(private readonly memberships: Map<string, AccountWithMembership[]> = new Map()) {}

  static withOwner(userId: string, account = makeAccount()): FakeAccountRepository {
    return new FakeAccountRepository(
      new Map([[userId, [{ account, membershipRole: 'OWNER' as MembershipRole }]]]),
    );
  }

  async findById(id: string): Promise<AccountRecord | null> {
    for (const list of this.memberships.values()) {
      const found = list.find((item) => item.account.id === id);
      if (found) return found.account;
    }
    return null;
  }

  async listForUser(userId: string): Promise<AccountWithMembership[]> {
    return this.memberships.get(userId) ?? [];
  }

  /** Simula revogação do vínculo entre o login e a próxima operação. */
  revokeMemberships(userId: string): void {
    this.memberships.set(userId, []);
  }
}

export class FakeRefreshTokenRepository implements RefreshTokenRepository {
  readonly tokens: RefreshTokenRecord[] = [];

  async create(input: IssueRefreshTokenInput): Promise<void> {
    this.tokens.push({ ...input, revokedAt: null, replacedById: null });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.tokens.find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async rotate(previousId: string, next: IssueRefreshTokenInput, at: Date): Promise<void> {
    const previous = this.tokens.find((token) => token.id === previousId);
    if (previous) {
      previous.revokedAt = at;
      previous.replacedById = next.id;
    }
    await this.create(next);
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.sessionId === sessionId && !token.revokedAt) token.revokedAt = at;
    }
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.userId === userId && !token.revokedAt) token.revokedAt = at;
    }
  }

  get activeCount(): number {
    return this.tokens.filter((token) => !token.revokedAt).length;
  }
}

/**
 * Tokens opacos e previsíveis: `access:<sessionId>` / `refresh:<tokenId>`.
 *
 * Fiel ao contrato do JoseTokenService em dois pontos que importam:
 *   - falha de verificação lança UnauthenticatedError, não Error cru — senão o
 *     teste passa com um 500 disfarçado de 401;
 *   - a expiração usa o MESMO Clock injetado nos use cases, senão o relógio do
 *     teste e o do token divergem e "token expirado" nunca expira.
 */
export class FakeTokenService implements TokenService {
  private readonly access = new Map<string, AccessTokenClaims>();
  private readonly refresh = new Map<string, RefreshTokenClaims>();

  constructor(
    private readonly clock: Clock = new FixedClock(),
    private readonly accessTtlSeconds = 900,
    private readonly refreshTtlSeconds = 30 * 86400,
  ) {}

  private expiresIn(seconds: number): Date {
    return new Date(this.clock.now().getTime() + seconds * 1000);
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedToken> {
    const token = `access:${claims.sessionId}:${this.access.size}`;
    this.access.set(token, claims);
    return { token, expiresAt: this.expiresIn(this.accessTtlSeconds) };
  }

  async issueRefreshToken(claims: RefreshTokenClaims): Promise<IssuedToken> {
    const token = `refresh:${claims.tokenId}`;
    this.refresh.set(token, claims);
    return { token, expiresAt: this.expiresIn(this.refreshTtlSeconds) };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const claims = this.access.get(token);
    if (!claims) throw new UnauthenticatedError('TOKEN_INVALID', 'Token inválido.');
    return claims;
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const claims = this.refresh.get(token);
    if (!claims) throw new UnauthenticatedError('TOKEN_INVALID', 'Token inválido.');
    return claims;
  }
}

/**
 * Hasher determinístico. `verify` registra TODA chamada — é o que permite
 * provar que o login gasta o mesmo trabalho para e-mail inexistente.
 */
export class FakePasswordHasher implements PasswordHasher {
  readonly verifyCalls: Array<{ plainText: string; hash: string }> = [];
  needsRehashResult = false;

  async hash(plainText: string): Promise<string> {
    return `scrypt$${plainText}`;
  }

  async verify(plainText: string, hash: string): Promise<boolean> {
    this.verifyCalls.push({ plainText, hash });
    return hash === `scrypt$${plainText}`;
  }

  needsRehash(): boolean {
    return this.needsRehashResult;
  }
}

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-06-01T12:00:00Z')) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `id-${String(this.counter).padStart(4, '0')}`;
  }
}

export class RecordingLogger implements Logger {
  readonly entries: Array<{ level: string; fields: LogFields; message: string }> = [];

  debug(fields: LogFields, message: string): void {
    this.entries.push({ level: 'debug', fields, message });
  }
  info(fields: LogFields, message: string): void {
    this.entries.push({ level: 'info', fields, message });
  }
  warn(fields: LogFields, message: string): void {
    this.entries.push({ level: 'warn', fields, message });
  }
  error(fields: LogFields, message: string): void {
    this.entries.push({ level: 'error', fields, message });
  }
  child(): Logger {
    return this;
  }
}

export const REQUEST_INFO = { userAgent: 'vitest', ip: '127.0.0.1' };
