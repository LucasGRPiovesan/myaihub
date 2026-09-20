import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../../../config/env.js';
import { assertTenantScoped } from './tenant-guard.js';

function createPrismaClient() {
  const base = new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

  return base.$extends({
    name: 'tenantGuard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          assertTenantScoped(model, operation, args);
          return query(args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof createPrismaClient>;

/**
 * Cliente transacional. Os métodos de ciclo de vida não existem dentro de uma
 * transação interativa — tipá-los fora evita uso indevido.
 */
export type DbTx = Omit<Db, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

let instance: Db | undefined;

export function getDb(): Db {
  instance ??= createPrismaClient();
  return instance;
}

export async function disconnectDb(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
    instance = undefined;
  }
}
