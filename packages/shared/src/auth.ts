import { z } from 'zod';

/**
 * Papéis globais da plataforma.
 *
 * ADMIN tem privilégio global, mas possui a própria Account e usa o produto
 * normalmente. Acesso cross-tenant nunca é implícito: exige elevação explícita
 * e auditada. Ver docs/ARCHITECTURE.md §12.
 */
export const USER_ROLES = ['ADMIN', 'USER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Papel dentro de uma Account específica. */
export const MEMBERSHIP_ROLES = ['OWNER', 'MEMBER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

// -----------------------------------------------------------------------------
// Senha
// -----------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(200, 'A senha é longa demais.')
  .refine((value) => /[a-z]/.test(value), 'A senha deve conter uma letra minúscula.')
  .refine((value) => /[A-Z]/.test(value), 'A senha deve conter uma letra maiúscula.')
  .refine((value) => /\d/.test(value), 'A senha deve conter um número.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'E-mail inválido.');

// -----------------------------------------------------------------------------
// Contratos de request
// -----------------------------------------------------------------------------

export const registerRequestSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  email: emailSchema,
  password: passwordSchema,
  accountName: z.string().trim().min(2).max(120).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.').max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// -----------------------------------------------------------------------------
// Contratos de response
// -----------------------------------------------------------------------------

export interface AccountSummary {
  id: string;
  name: string;
  slug: string;
  membershipRole: MembershipRole;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  activeAccount: AccountSummary;
  accounts: AccountSummary[];
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  /**
   * O access token também vai em cookie httpOnly. É devolvido no corpo apenas
   * para clientes que não são o app web (ex.: testes de API).
   */
  accessToken: string;
  accessTokenExpiresAt: string;
}
