import type { Logger } from '../shared/application/ports.js';
import type { TenantContext } from '../shared/application/tenant-context.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      /** Presente apenas em rotas autenticadas. */
      tenant?: TenantContext;
      auth?: {
        userId: string;
        accountId: string;
        role: string;
        sessionId: string;
      };
    }
  }
}

export {};
