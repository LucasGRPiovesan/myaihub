import type { MembershipRole, UserRole } from '@myaihub/shared';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AccountRecord {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
}

export interface AccountWithMembership {
  account: AccountRecord;
  membershipRole: MembershipRole;
}

export interface RefreshTokenRecord {
  id: string;
  sessionId: string;
  userId: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/**
 * Converte um nome de conta em slug estável.
 * Não garante unicidade — quem persiste resolve colisão com sufixo.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return slug || 'conta';
}

/** Nome padrão da conta pessoal quando o usuário não informa um. */
export function defaultAccountName(userName: string): string {
  const firstName = userName.trim().split(/\s+/)[0] ?? userName.trim();
  return `Conta de ${firstName}`;
}
