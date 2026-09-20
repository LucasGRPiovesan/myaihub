import type { Request } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../shared/domain/errors.js';

/**
 * O backend é a autoridade de validação (§68). TypeScript não valida nada em
 * runtime — toda borda passa por Zod.
 */
export function parseBody<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    throw new ValidationError(
      'Dados inválidos.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    throw new ValidationError(
      'Parâmetros inválidos.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseParams<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.params);
  if (!result.success) {
    throw new ValidationError(
      'Parâmetros inválidos.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
