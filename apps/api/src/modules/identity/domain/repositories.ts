import type { MembershipRole } from '@myaihub/shared';
import type { AuditEntry } from '../../../shared/application/ports.js';
import type {
  AccountRecord,
  AccountWithMembership,
  RefreshTokenRecord,
  UserRecord,
} from './types.js';

/**
 * Repositórios de identity.
 *
 * Estes NÃO recebem TenantContext: identity é o contexto que RESOLVE o tenant.
 * Buscar usuário por e-mail no login ou membership por userId acontece antes de
 * existir escopo. Ver tenant-policy.ts para a classificação correspondente.
 */

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  registerLogin(userId: string, at: Date): Promise<void>;
}

export interface AccountRepository {
  findById(id: string): Promise<AccountRecord | null>;
  /** Contas às quais o usuário pertence, com o papel dele em cada uma. */
  listForUser(userId: string): Promise<AccountWithMembership[]>;
}

export interface CreateUserWithAccountInput {
  user: {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
  };
  account: {
    id: string;
    name: string;
    slugBase: string;
  };
  membership: {
    id: string;
    role: MembershipRole;
  };
  /**
   * Gravado DENTRO da mesma transação (§69).
   *
   * Auditoria escrita depois do commit pode falhar sozinha e deixar uma conta
   * criada sem rastro — que é exatamente o registro que mais importa existir.
   */
  audit: AuditEntry;
}

export interface CreateUserWithAccountResult {
  user: UserRecord;
  account: AccountRecord;
  membershipRole: MembershipRole;
}

export interface RegistrationRepository {
  /**
   * Cria User + Account + Membership atomicamente (§69).
   * Resolve colisão de slug internamente.
   * Lança ConflictError('EMAIL_ALREADY_IN_USE') se o e-mail já existir.
   */
  createUserWithAccount(input: CreateUserWithAccountInput): Promise<CreateUserWithAccountResult>;
}

export interface IssueRefreshTokenInput {
  id: string;
  sessionId: string;
  userId: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export interface RefreshTokenRepository {
  create(input: IssueRefreshTokenInput): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Rotação: revoga o antigo e cria o novo na mesma transação. */
  rotate(previousId: string, next: IssueRefreshTokenInput, at: Date): Promise<void>;
  revokeSession(sessionId: string, at: Date): Promise<void>;
  /** Revoga todas as sessões do usuário — usado na detecção de reuso de token. */
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export interface AuditLogEntryView {
  id: string;
  accountId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AuditLogReadRepository {
  /** Tenant-scoped: exige accountId explícito. */
  listForAccount(
    accountId: string,
    limit: number,
    cursor: string | null,
  ): Promise<AuditLogEntryView[]>;
}
