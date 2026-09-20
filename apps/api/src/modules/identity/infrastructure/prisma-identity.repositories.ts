import type { AuditWriter } from '../../../shared/application/ports.js';
import { ConflictError } from '../../../shared/domain/errors.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import {
  isUniqueViolationOn,
  withWriteConflictRetry,
} from '../../../shared/infrastructure/prisma/transaction.js';
import type {
  AccountRepository,
  AuditLogEntryView,
  AuditLogReadRepository,
  CreateUserWithAccountInput,
  CreateUserWithAccountResult,
  IssueRefreshTokenInput,
  RefreshTokenRepository,
  RegistrationRepository,
  UserRepository,
} from '../domain/repositories.js';
import type {
  AccountRecord,
  AccountWithMembership,
  RefreshTokenRecord,
  UserRecord,
} from '../domain/types.js';

/** Sufixos tentados antes de desistir de gerar um slug livre. */
const MAX_SLUG_ATTEMPTS = 20;

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async registerLogin(userId: string, at: Date): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<AccountRecord | null> {
    return this.db.account.findUnique({ where: { id } });
  }

  async listForUser(userId: string): Promise<AccountWithMembership[]> {
    const memberships = await this.db.accountMembership.findMany({
      where: { userId },
      include: { account: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      account: membership.account,
      membershipRole: membership.role,
    }));
  }
}

export class PrismaRegistrationRepository implements RegistrationRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * Cria User + Account + Membership atomicamente.
   *
   * O slug é resolvido por TENTATIVA DE INSERÇÃO, não por consulta prévia:
   * "verificar se está livre e então inserir" tem uma janela entre as duas
   * operações na qual outro cadastro toma o mesmo slug. Deixar o índice único
   * decidir é a única forma correta sob concorrência.
   */
  async createUserWithAccount(
    input: CreateUserWithAccountInput,
  ): Promise<CreateUserWithAccountResult> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug =
        attempt === 0 ? input.account.slugBase : `${input.account.slugBase}-${attempt + 1}`;

      try {
        return await withWriteConflictRetry(() => this.insertRegistration(input, slug));
      } catch (error) {
        if (isUniqueViolationOn(error, 'email')) {
          throw new ConflictError('EMAIL_ALREADY_IN_USE', 'Este e-mail já está cadastrado.');
        }
        if (isUniqueViolationOn(error, 'slug')) {
          continue; // sufixo ocupado: tenta o próximo
        }
        throw error;
      }
    }

    throw new ConflictError(
      'CONFLICT',
      'Não foi possível gerar um identificador único para a conta. Escolha outro nome.',
    );
  }

  private async insertRegistration(
    input: CreateUserWithAccountInput,
    slug: string,
  ): Promise<CreateUserWithAccountResult> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: input.user.id,
          name: input.user.name,
          email: input.user.email,
          passwordHash: input.user.passwordHash,
        },
      });

      const account = await tx.account.create({
        data: { id: input.account.id, name: input.account.name, slug },
      });

      await tx.accountMembership.create({
        data: {
          id: input.membership.id,
          accountId: account.id,
          userId: user.id,
          role: input.membership.role,
        },
      });

      // Mesma transação: conta criada e auditoria vivem ou morrem juntas (§69).
      await this.audit.write(input.audit, tx);

      return { user, account, membershipRole: input.membership.role };
    });
  }
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Db) {}

  async create(input: IssueRefreshTokenInput): Promise<void> {
    await this.db.refreshToken.create({ data: input });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  async rotate(previousId: string, next: IssueRefreshTokenInput, at: Date): Promise<void> {
    await this.db.$transaction([
      this.db.refreshToken.create({ data: next }),
      this.db.refreshToken.update({
        where: { id: previousId },
        data: { revokedAt: at, replacedById: next.id },
      }),
    ]);
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}

export class PrismaAuditLogReadRepository implements AuditLogReadRepository {
  constructor(private readonly db: Db) {}

  async listForAccount(
    accountId: string,
    limit: number,
    cursor: string | null,
  ): Promise<AuditLogEntryView[]> {
    // accountId sempre no where: é o que o tenantGuard exige e o que fecha IDOR.
    const rows = await this.db.auditLog.findMany({
      where: cursor ? { accountId, id: { lt: cursor } } : { accountId },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      actorUserId: row.actorUserId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  }
}
