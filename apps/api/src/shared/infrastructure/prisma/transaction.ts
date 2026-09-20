import { Prisma } from '@prisma/client';

/**
 * Códigos do Prisma relevantes para escrita concorrente.
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
const WRITE_CONFLICT = 'P2034'; // deadlock ou write conflict — retentável
const UNIQUE_VIOLATION = 'P2002';

export function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === WRITE_CONFLICT;
}

/**
 * True quando a violação de unicidade envolve o campo informado.
 *
 * O `target` varia por conector: no MySQL costuma vir o nome do índice
 * (`users_email_key`), no Postgres a lista de campos. Cobrimos os dois.
 */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== UNIQUE_VIOLATION) return false;

  const target = error.meta?.['target'];
  if (typeof target === 'string') return target.toLowerCase().includes(field.toLowerCase());
  if (Array.isArray(target)) {
    return target.some(
      (item) => typeof item === 'string' && item.toLowerCase().includes(field.toLowerCase()),
    );
  }
  return false;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Reexecuta uma operação que falhou por deadlock/write conflict.
 *
 * Deadlock no InnoDB não é bug: com inserts concorrentes que tocam as mesmas
 * chaves estrangeiras, o banco escolhe uma vítima e a aborta — o comportamento
 * correto do lado da aplicação é REPETIR, não devolver 500. Ignorar isso produz
 * falhas intermitentes que só aparecem sob carga, que é o pior momento.
 *
 * O backoff tem jitter para que duas transações que se mataram não voltem
 * exatamente juntas e se matem de novo.
 */
export async function withWriteConflictRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 25;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isWriteConflict(error)) throw error;

      lastError = error;
      const delay = baseDelayMs * 2 ** attempt * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
