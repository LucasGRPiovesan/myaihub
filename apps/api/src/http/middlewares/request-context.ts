import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';
import type { Logger } from '../../shared/application/ports.js';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_INCOMING_ID_LENGTH = 40;

/**
 * Anexa requestId e logger contextual a cada request (§66).
 *
 * Um requestId vindo do cliente é aceito para permitir correlação ponta a ponta,
 * mas é sanitizado: é ele que vai parar em logs e no corpo do erro.
 */
export function requestContext(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const incoming = request.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && /^[A-Za-z0-9_-]{1,40}$/.test(incoming.slice(0, MAX_INCOMING_ID_LENGTH))
        ? incoming.slice(0, MAX_INCOMING_ID_LENGTH)
        : ulid();

    request.requestId = requestId;
    request.log = logger.child({ requestId });
    response.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  };
}
