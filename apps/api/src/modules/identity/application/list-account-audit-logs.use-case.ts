import type { AuditWriter } from '../../../shared/application/ports.js';
import {
  elevateScope,
  runWithTenantContext,
  type TenantContext,
} from '../../../shared/application/tenant-context.js';
import { ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import type {
  AccountRepository,
  AuditLogEntryView,
  AuditLogReadRepository,
} from '../domain/repositories.js';

export interface ListAccountAuditLogsInput {
  targetAccountId: string;
  limit: number;
  cursor: string | null;
  /** Obrigatório quando o alvo não é a conta do próprio contexto. */
  reason?: string;
}

/**
 * Lista a auditoria de uma conta.
 *
 * É o primeiro recurso realmente tenant-scoped do sistema, então é aqui que os
 * Flows 7 e 8 (§72) se provam:
 *
 *   - USER pedindo outra conta        → 404 (não confirmamos existência)
 *   - ADMIN pedindo outra conta       → precisa de motivo, é auditado, e funciona
 *   - qualquer um pedindo a própria   → funciona sem elevação
 *
 * Ver docs/ARCHITECTURE.md §12.
 */
export class ListAccountAuditLogsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly auditLogs: AuditLogReadRepository,
    private readonly audit: AuditWriter,
  ) {}

  async execute(
    context: TenantContext,
    input: ListAccountAuditLogsInput,
  ): Promise<AuditLogEntryView[]> {
    const isOwnAccount = context.accountId === input.targetAccountId;

    if (isOwnAccount) {
      return this.auditLogs.listForAccount(input.targetAccountId, input.limit, input.cursor);
    }

    if (context.role !== 'ADMIN') {
      // 404, não 403: para quem não é admin, contas alheias simplesmente não existem.
      throw new NotFoundError('NOT_FOUND', 'Conta não encontrada.');
    }

    const reason = input.reason?.trim();
    if (!reason) {
      throw new ForbiddenError(
        'ELEVATION_REQUIRED',
        'Acesso a outra conta exige o cabeçalho X-Elevation-Reason com uma justificativa.',
      );
    }

    const target = await this.accounts.findById(input.targetAccountId);
    if (!target) {
      throw new NotFoundError('NOT_FOUND', 'Conta não encontrada.');
    }

    const elevated = elevateScope(context, input.targetAccountId, reason);

    await this.audit.write({
      accountId: input.targetAccountId,
      actorUserId: context.userId,
      action: 'admin.cross_tenant_access',
      entityType: 'AuditLog',
      entityId: null,
      metadata: { reason, fromAccountId: context.accountId },
    });

    return runWithTenantContext(elevated, () =>
      this.auditLogs.listForAccount(input.targetAccountId, input.limit, input.cursor),
    );
  }
}
