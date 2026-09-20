import pino, { type Logger as PinoLogger } from 'pino';
import { env, isDevelopment } from '../../../config/env.js';
import type { LogFields, Logger } from '../../application/ports.js';

/**
 * Campos que NUNCA podem ser logados (§66). A redação acontece no serializer,
 * não na chamada — para não depender de disciplina em cada call site.
 */
const REDACTED_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export const rootPinoLogger: PinoLogger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'myaihub-api' },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

class PinoLoggerAdapter implements Logger {
  constructor(private readonly logger: PinoLogger) {}

  debug(fields: LogFields, message: string): void {
    this.logger.debug(fields, message);
  }
  info(fields: LogFields, message: string): void {
    this.logger.info(fields, message);
  }
  warn(fields: LogFields, message: string): void {
    this.logger.warn(fields, message);
  }
  error(fields: LogFields, message: string): void {
    this.logger.error(fields, message);
  }
  child(fields: LogFields): Logger {
    return new PinoLoggerAdapter(this.logger.child(fields));
  }
}

export function createLogger(): Logger {
  return new PinoLoggerAdapter(rootPinoLogger);
}
