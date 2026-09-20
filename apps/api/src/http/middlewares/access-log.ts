import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import morgan from 'morgan';
import { env } from '../../config/env.js';
import type { Logger } from '../../shared/application/ports.js';

/**
 * Log de acesso por requisição.
 *
 * Não existia: o `requestContext` anexa um logger à requisição, mas nada
 * registrava que ela aconteceu. Um 404 ou um 422 sumia sem deixar rastro, e a
 * única forma de saber o que o frontend chamou era abrir o DevTools.
 *
 * Duas saídas, porque são dois leitores:
 *
 *   DESENVOLVIMENTO  uma linha colorida por requisição, legível de relance
 *                    enquanto o terminal rola.
 *   PRODUÇÃO         a mesma informação como JSON estruturado, pelo mesmo
 *                    logger do resto — misturar texto solto no stream de logs
 *                    quebra a ingestão de quem consome isso lá.
 *
 * O `requestId` entra nas duas: é ele que liga esta linha ao erro detalhado que
 * o error handler registra depois.
 */

/** Ruído que não ajuda ninguém a diagnosticar nada. */
const IGNORED_PATHS = ['/health', '/favicon.ico'];

morgan.token('requestId', (request) => (request as { requestId?: string }).requestId ?? '-');

export function accessLog(logger: Logger): RequestHandler {
  const skip = (request: IncomingMessage): boolean =>
    IGNORED_PATHS.some((path) => request.url?.startsWith(path) ?? false);

  if (env.NODE_ENV === 'production') {
    return morgan(
      (tokens, request, response) =>
        JSON.stringify({
          level: 'info',
          msg: 'request',
          requestId: tokens['requestId']?.(request, response),
          method: tokens['method']?.(request, response),
          url: tokens['url']?.(request, response),
          status: Number(tokens['status']?.(request, response) ?? 0),
          durationMs: Number(tokens['response-time']?.(request, response) ?? 0),
        }),
      {
        skip,
        // Sai pelo logger da aplicação, não por `console`: um stream só.
        stream: { write: (line) => logger.info(JSON.parse(line), 'request') },
      },
    );
  }

  // `dev` já colore por faixa de status — 2xx verde, 4xx amarelo, 5xx vermelho.
  return morgan('dev', { skip });
}
