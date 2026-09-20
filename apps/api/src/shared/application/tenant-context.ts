import { AsyncLocalStorage } from 'node:async_hooks';
import type { MembershipRole, UserRole } from '@myaihub/shared';
import { ForbiddenError } from '../domain/errors.js';

/**
 * Escopo de tenant de uma unidade de trabalho.
 *
 * É passado EXPLICITAMENTE para use cases e repositórios tenant-scoped — essa é
 * a regra primária de isolamento. O AsyncLocalStorage abaixo existe apenas para
 * alimentar o tenantGuard do Prisma (defense-in-depth), nunca como substituto
 * da passagem explícita.
 *
 * Ver docs/ARCHITECTURE.md §12.
 */
export interface TenantContext {
  readonly accountId: string;
  readonly userId: string | null;
  readonly role: UserRole | 'SYSTEM' | 'PUBLIC';
  readonly membershipRole: MembershipRole | null;
  /** Habilita acesso cross-tenant. Só via elevateScope(), sempre auditado. */
  readonly elevated: boolean;
  readonly reason?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Executa `fn` com o contexto ativo para o tenantGuard do Prisma.
 *
 * O `await` interno não é enfeite — é o que faz a elevação sobreviver.
 *
 * `AsyncLocalStorage.run` restaura o escopo anterior assim que `fn` RETORNA, e
 * o Prisma só DISPARA a consulta quando a promessa é aguardada. Com um callback
 * síncrono — `runWithTenantContext(ctx, () => db.algo.findFirst())` — a consulta
 * saía depois de o escopo ter fechado, e o guard via contexto vazio: a elevação
 * simplesmente sumia, sem aviso, com a chamada parecendo correta.
 *
 * Medido: a MESMA consulta passa com `async () => ...` e falha com `() => ...`.
 * Um detalhe assim não pode ficar por conta de quem chama — havia cinco call
 * sites, e o erro é invisível até alguém tentar ler o que não deveria.
 *
 * Aguardando aqui dentro, o escopo fica vivo até a consulta terminar e as duas
 * formas passam a valer igual.
 */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, () => {
    const resultado = fn();
    const promessa = typeof (resultado as { then?: unknown } | null)?.then === 'function';

    return (promessa ? (async () => await resultado)() : resultado) as T;
  });
}

export function getCurrentTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Contexto de sistema: seeds, migrações de dados e scripts.
 * Elevado por natureza — por isso exige motivo explícito.
 */
export function systemTenantContext(reason: string): TenantContext {
  return {
    accountId: '__system__',
    userId: null,
    role: 'SYSTEM',
    membershipRole: null,
    elevated: true,
    reason,
  };
}

/**
 * Contexto do Public Chat. Não tem usuário, mas TEM tenant: o accountId é
 * derivado no servidor a partir do publicId → deployment → campaign.
 * Nunca vem do request. Ver docs/ARCHITECTURE.md §12.
 */
export function publicTenantContext(accountId: string): TenantContext {
  return {
    accountId,
    userId: null,
    role: 'PUBLIC',
    membershipRole: null,
    elevated: false,
  };
}

/**
 * Eleva o escopo para acesso cross-tenant. Só ADMIN, sempre com motivo.
 * O registro em AuditLog é responsabilidade do use case que chama isto —
 * ver ElevateScopeUseCase.
 */
export function elevateScope(
  context: TenantContext,
  targetAccountId: string,
  reason: string,
): TenantContext {
  if (context.role !== 'ADMIN' && context.role !== 'SYSTEM') {
    throw new ForbiddenError('CROSS_TENANT_FORBIDDEN', 'Acesso a outro tenant não permitido.');
  }
  if (!reason.trim()) {
    throw new ForbiddenError('ELEVATION_REQUIRED', 'Elevação de escopo exige um motivo.');
  }

  return {
    accountId: targetAccountId,
    userId: context.userId,
    role: context.role,
    membershipRole: null,
    elevated: true,
    reason,
  };
}

/**
 * Garante que o contexto pode operar sobre `accountId`.
 * Use em toda fronteira de use case que recebe um accountId vindo do request.
 */
export function assertTenantAccess(context: TenantContext, accountId: string): void {
  if (context.accountId === accountId) return;
  if (context.elevated) return;
  // 404 seria mais discreto, mas quem chega aqui está autenticado e o recurso
  // existe; o handler HTTP é quem decide mascarar como 404 quando apropriado.
  throw new ForbiddenError('CROSS_TENANT_FORBIDDEN', 'Recurso pertence a outra conta.');
}
