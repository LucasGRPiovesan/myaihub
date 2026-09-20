import type { ApiErrorBody } from '@myaihub/shared';
import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { isTest } from '../../config/env.js';

function handler(request: Request, response: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'RATE_LIMITED',
      message: 'Muitas requisições. Tente novamente em instantes.',
      requestId: request.requestId,
    },
  };
  response.status(429).json(body);
}

function build(options: Pick<Options, 'windowMs' | 'limit'> & { name: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    // Testes de integração fazem muitas chamadas em sequência; limitar ali
    // testaria o rate limiter, não o comportamento sob teste.
    skip: () => isTest,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
  });
}

/** Limite geral da API. Generoso — existe para conter abuso, não uso normal. */
export const generalRateLimit = build({ name: 'general', windowMs: 60_000, limit: 300 });

/**
 * Limite agressivo para autenticação: é a superfície de força bruta e de
 * enumeração de usuários.
 */
export const authRateLimit = build({ name: 'auth', windowMs: 15 * 60_000, limit: 20 });

/**
 * Limite do Public Chat: rota SEM autenticação que gasta API paga.
 *
 * É a única superfície do produto em que um anônimo faz o sistema chamar o
 * provider. Sem teto, um script transforma a conta de quem publicou numa
 * fatura — e o dono só descobre depois. Vinte turnos por minuto é folgado para
 * uma pessoa conversando e apertado para quem automatiza.
 */
export const publicChatRateLimit = build({ name: 'public-chat', windowMs: 60_000, limit: 20 });
