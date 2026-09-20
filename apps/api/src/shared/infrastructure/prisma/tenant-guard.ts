import { TenantScopeMissingError } from '../../domain/errors.js';
import { getCurrentTenantContext } from '../../application/tenant-context.js';
import { getModelTenantPolicy } from './tenant-policy.js';

/**
 * Guard de tenant do Prisma — defense-in-depth.
 *
 * A regra PRIMÁRIA de isolamento é passar TenantContext explicitamente para os
 * use cases e repositórios. Este guard existe para que um esquecimento humano
 * vire uma exceção barulhenta em desenvolvimento, e não um vazamento silencioso
 * em produção.
 *
 * Ele nunca injeta accountId automaticamente. Filtrar por baixo dos panos
 * mascararia o bug; lançar o expõe.
 *
 * Consequência deliberada: `findUnique({ where: { id } })` em modelo
 * tenant-scoped é REJEITADO. Use `findFirst({ where: { id, accountId } })`.
 * É precisamente o padrão que fecha IDOR.
 *
 * Ver docs/ARCHITECTURE.md §12.
 */

const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Considera preenchido um accountId em `{ accountId }`, `{ accountId: { in: [...] } }` e dentro de `AND`. */
function whereHasAccountId(where: unknown): boolean {
  if (!isRecord(where)) return false;

  if (where['accountId'] !== undefined && where['accountId'] !== null) return true;

  const and = where['AND'];
  if (Array.isArray(and)) {
    return and.some((clause) => whereHasAccountId(clause));
  }
  if (isRecord(and)) {
    return whereHasAccountId(and);
  }

  return false;
}

function dataHasAccountId(data: unknown): boolean {
  if (Array.isArray(data)) {
    return data.length > 0 && data.every((item) => dataHasAccountId(item));
  }
  if (!isRecord(data)) return false;
  if (typeof data['accountId'] === 'string' && data['accountId'].length > 0) return true;
  // relação conectada: { account: { connect: { id } } }
  const account = data['account'];
  if (isRecord(account) && (isRecord(account['connect']) || isRecord(account['create']))) {
    return true;
  }
  return false;
}

export function assertTenantScoped(
  model: string | undefined,
  operation: string,
  args: unknown,
): void {
  // Operações sem modelo (raw, $transaction) não passam por aqui de forma útil.
  // Raw SQL é barrado por lint rule — ver eslint.config.js.
  if (!model) return;

  const policy = getModelTenantPolicy(model);
  if (!policy) {
    throw new TenantScopeMissingError(
      model,
      `${operation} (modelo não classificado em tenant-policy.ts)`,
    );
  }
  if (policy.scope === 'UNSCOPED') return;

  const context = getCurrentTenantContext();
  if (context?.elevated) return;

  const parsedArgs = isRecord(args) ? args : {};

  if (operation === 'upsert') {
    if (whereHasAccountId(parsedArgs['where']) && dataHasAccountId(parsedArgs['create'])) return;
    throw new TenantScopeMissingError(model, operation);
  }

  if (CREATE_OPERATIONS.has(operation)) {
    if (dataHasAccountId(parsedArgs['data'])) return;
    throw new TenantScopeMissingError(model, operation);
  }

  if (WHERE_OPERATIONS.has(operation)) {
    if (whereHasAccountId(parsedArgs['where'])) return;
    throw new TenantScopeMissingError(model, operation);
  }

  // Operação desconhecida em modelo tenant-scoped: falha fechada.
  throw new TenantScopeMissingError(model, `${operation} (operação não reconhecida pelo guard)`);
}
