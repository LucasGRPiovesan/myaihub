/**
 * Catálogo de códigos de erro da API.
 *
 * O código é parte do contrato público: o frontend reage a ele, não à mensagem.
 * Mensagens são humanas e podem mudar; códigos, não.
 *
 * Ver docs/ARCHITECTURE.md §67.
 */
export const ERROR_CODES = [
  // genéricos
  'INTERNAL_ERROR',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',

  // autenticação / autorização
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'FORBIDDEN',
  'EMAIL_ALREADY_IN_USE',
  'ACCOUNT_INACTIVE',

  // tenant
  'TENANT_SCOPE_MISSING',
  'CROSS_TENANT_FORBIDDEN',
  'ELEVATION_REQUIRED',

  // concorrência / versionamento
  'CONCURRENCY_CONFLICT',
  'VERSION_NOT_FOUND',

  // domínio
  'PROJECT_NOT_FOUND',
  'AGENT_NOT_FOUND',
  'CAMPAIGN_NOT_FOUND',
  'DEPLOYMENT_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'CAPABILITY_NOT_ENABLED',

  // IA
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_ERROR',
  'PROVIDER_TIMEOUT',
  // O provider recusou por sobrecarga (503) ou limite de taxa (429). Distinto de
  // PROVIDER_ERROR porque a ação certa é OUTRA: esperar e repetir, não corrigir.
  'PROVIDER_UNAVAILABLE',
  'STRUCTURED_OUTPUT_INVALID',
  'MUTATION_OUT_OF_SCOPE',
  'CANONICAL_SCHEMA_INVALID',
  'RULE_VIOLATION_UNRECOVERABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Envelope de erro devolvido pela API. Formato único, sempre. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    /** Detalhes estruturados — usado por VALIDATION_ERROR. Nunca contém dados sensíveis. */
    details?: unknown;
  };
}
