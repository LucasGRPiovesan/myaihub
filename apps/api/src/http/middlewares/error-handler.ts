import type { ApiErrorBody, ErrorCode } from '@myaihub/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../../config/env.js';
import { AppError } from '../../shared/domain/errors.js';

interface NormalizedError {
  code: ErrorCode;
  message: string;
  httpStatus: number;
  details?: unknown;
  unexpected: boolean;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus,
      details: error.details,
      unexpected: error.unexpected,
    };
  }

  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
      httpStatus: 422,
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      unexpected: false,
    };
  }

  // Body malformado vem do body-parser como SyntaxError com status 400.
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'JSON malformado.',
      httpStatus: 400,
      unexpected: false,
    };
  }

  // Schema ausente NÃO é erro interno: é setup pendente, com solução conhecida.
  //
  // O `assertSchemaApplied` cobre o boot, mas não cobre o caso real que
  // aconteceu: a API já estava no ar quando o volume do MySQL foi recriado. Aí
  // toda rota passava a responder "Erro interno", que é a pior resposta
  // possível — manda procurar bug onde só falta rodar uma migração.
  const setup = schemaSetupMessage(error);
  if (setup) {
    return {
      code: 'INTERNAL_ERROR',
      message: setup,
      httpStatus: 503,
      unexpected: false,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Erro interno.',
    httpStatus: 500,
    unexpected: true,
  };
}

/** `null` quando o erro não é de schema faltando. */
function schemaSetupMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;

  const code = String((error as { code: unknown }).code);
  // P2021 tabela ausente · P2022 coluna ausente.
  if (code !== 'P2021' && code !== 'P2022') return null;

  return (
    'O banco de dados não tem o schema da aplicação — provavelmente o container ' +
    'do MySQL foi recriado. Rode `npm run db:migrate:deploy` e depois `npm run db:seed`.'
  );
}

/**
 * Handler de erro único da API. Formato de resposta é sempre o mesmo (§67).
 *
 * Erros inesperados nunca vazam mensagem original ao cliente — só o requestId,
 * que é o que permite achar o log correspondente.
 */
export function errorHandler() {
  return (error: unknown, request: Request, response: Response, next: NextFunction): void => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const normalized = normalizeError(error);
    // O código do Prisma é o que diferencia "violação de unicidade" de
    // "deadlock" de "timeout" — sem ele, todo erro de banco vira um
    // INTERNAL_ERROR indistinguível no log.
    // Só para erros que NÃO são nossos: um AppError também tem `code`, e
    // reportá-lo aqui duplicaria a informação sob um nome enganoso.
    const prismaCode =
      !(error instanceof AppError) && typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : undefined;

    const logFields = {
      code: normalized.code,
      prismaCode,
      httpStatus: normalized.httpStatus,
      method: request.method,
      path: request.path,
      userId: request.auth?.userId,
      accountId: request.auth?.accountId,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    };

    if (normalized.unexpected) {
      request.log.error(logFields, 'requisição falhou');
    } else {
      request.log.warn(logFields, 'requisição rejeitada');
    }

    const body: ApiErrorBody = {
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId: request.requestId,
      },
    };

    if (normalized.details !== undefined) {
      body.error.details = normalized.details;
    }
    if (normalized.unexpected && !isProduction && error instanceof Error) {
      body.error.details = { debug: error.message };
    }

    response.status(normalized.httpStatus).json(body);
  };
}

export function notFoundHandler() {
  return (request: Request, response: Response): void => {
    const body: ApiErrorBody = {
      error: {
        code: 'NOT_FOUND',
        message: `Rota não encontrada: ${request.method} ${request.path}`,
        requestId: request.requestId,
      },
    };
    response.status(404).json(body);
  };
}
