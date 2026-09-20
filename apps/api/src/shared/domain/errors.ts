import type { ErrorCode } from '@myaihub/shared';

/**
 * Erro da aplicação com código estável e status HTTP.
 *
 * O código é o contrato (o frontend reage a ele); a mensagem é humana.
 * `details` nunca deve conter dado sensível — ele vai para o corpo da resposta.
 *
 * Ver docs/ARCHITECTURE.md §67.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  /** Quando true, o handler HTTP loga como erro (não como aviso esperado). */
  readonly unexpected: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { httpStatus?: number; details?: unknown; cause?: unknown; unexpected?: boolean } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.unexpected = options.unexpected ?? false;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Violação de invariante de domínio. Erro do cliente, não do servidor. */
export class DomainError extends AppError {}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, { httpStatus: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(
      code,
      message,
      details !== undefined ? { httpStatus: 409, details } : { httpStatus: 409 },
    );
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: ErrorCode = 'UNAUTHENTICATED', message = 'Autenticação necessária.') {
    super(code, message, { httpStatus: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = 'FORBIDDEN', message = 'Acesso negado.') {
    super(code, message, { httpStatus: 403 });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos.', details?: unknown) {
    super('VALIDATION_ERROR', message, { httpStatus: 422, details });
  }
}

/**
 * Versionamento otimista falhou: alguém alterou o agregado no meio do caminho.
 * Ver docs/ARCHITECTURE.md §4.1.
 */
export class ConcurrencyError extends AppError {
  constructor(entity: string) {
    super(
      'CONCURRENCY_CONFLICT',
      `${entity} foi alterado por outra operação. Recarregue e tente novamente.`,
      { httpStatus: 409 },
    );
  }
}

/**
 * Uma query tenant-scoped foi executada sem escopo de tenant.
 *
 * Isto é um BUG, não um erro de usuário: significa que uma camada esqueceu de
 * propagar o TenantContext. Falha fechada. Ver docs/ARCHITECTURE.md §12.
 */
export class TenantScopeMissingError extends AppError {
  constructor(model: string, operation: string) {
    super(
      'TENANT_SCOPE_MISSING',
      `Operação "${operation}" no modelo tenant-scoped "${model}" sem accountId. ` +
        'Use um repositório com TenantContext, ou eleve o escopo explicitamente.',
      { httpStatus: 500, unexpected: true },
    );
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
