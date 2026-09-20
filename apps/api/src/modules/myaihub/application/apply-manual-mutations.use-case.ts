import type { AuditWriter, Clock, IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';
import { changesConfiguration } from '../domain/material-change.js';
import type { OperationTargetType } from '../domain/operation.js';
import { validateRuleCheck } from '../domain/rule-checks.js';
import type { AnyOperationTarget } from './operation-runner.js';

export interface ApplyManualMutationsInput {
  targetType: OperationTargetType;
  targetId: string;
  mutations: Array<{ kind: string }>;
  /** Frase curta que vai para o ConfigurationChange e para o histórico. */
  reason: string;
}

export interface ApplyManualMutationsResult {
  entityId: string;
  versionNumber: number;
  adjustments: string[];
  rejected: Array<{ kind: string; reason: string }>;
}

/**
 * Edição MANUAL da configuração canônica — sem LLM (§31).
 *
 * O painel é híbrido de propósito. Corrigir uma palavra num item, digitar a URL
 * de um CTA ou apagar uma linha são decisões que o usuário já tomou: passar
 * isso por um modelo custaria tokens e latência para adivinhar o que ele
 * acabou de escrever, e ainda poderia interpretar diferente.
 *
 * O que NÃO muda: continua sendo `CanonicalMutation` tipada, aplicada pelo
 * domínio, versionada com `ConfigurationChange` e auditoria na mesma transação.
 * O caminho manual não é uma porta dos fundos para o invariante — é o mesmo
 * portão, com outro remetente. Por isso `source: 'USER'`: o que o usuário
 * escreveu à mão tem precedência sobre inferência do OS, e a UI mostra isso.
 */
export class ApplyManualMutationsUseCase {
  constructor(
    private readonly deps: {
      targets: Record<OperationTargetType, AnyOperationTarget>;
      audit: AuditWriter;
      ids: IdGenerator;
      clock: Clock;
    },
  ) {}

  async execute(
    context: TenantContext,
    input: ApplyManualMutationsInput,
  ): Promise<ApplyManualMutationsResult> {
    const target = this.deps.targets[input.targetType];
    const existing = await target.load(context, input.targetId);

    if (!existing) {
      throw new NotFoundError('NOT_FOUND', 'O item que você quer editar não foi encontrado.');
    }

    const applied = target.applyMutations(existing.canonical, input.mutations, {
      // Sem restrição de operação: quem edita à mão está no escopo do próprio
      // documento. A fronteira que `allowedMutations` protege é a do MODELO,
      // que propõe o que não foi pedido — não a do dono da configuração.
      allowedMutations: input.mutations.map((mutation) => mutation.kind),
      now: this.deps.clock.now(),
      nextId: () => this.deps.ids.generate(),
      source: 'USER',
      validateCheck: validateRuleCheck,
    });

    if (applied.applied.length === 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        applied.rejected.map((item) => item.reason).join(' ') || 'Nada a aplicar.',
        { httpStatus: 422, details: applied.rejected },
      );
    }

    // Mutação APLICADA não é o mesmo que documento ALTERADO: gravar o valor que
    // já estava lá é uma mutação bem-sucedida que não muda coisa nenhuma.
    //
    // O painel manda `SET_AGENT_ENGAGEMENT` logo depois de criar o agente para
    // garantir a escolha do briefing — e quando a criação já tinha gravado a
    // mesma iniciativa, isso produzia uma v2 idêntica à v1 em TODO agente novo.
    // Versão que não diz nada polui o histórico justamente onde ele deveria
    // contar por que a configuração está como está.
    if (!changesConfiguration(existing.canonical, applied.canonical)) {
      return {
        entityId: input.targetId,
        versionNumber: existing.versionNumber ?? 0,
        adjustments: applied.adjustments,
        rejected: applied.rejected,
      };
    }

    const saved = await target.persist(context, {
      existing,
      parentId: null,
      canonical: applied.canonical,
      humanSummary: target.summarize(applied.canonical),
      mutations: applied.applied,
      interpretedIntent: input.reason,
      rationale: 'Edição manual feita pelo usuário no painel.',
      hubOperationId: null,
      hubMessageId: null,
    });

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'configuration.manually_edited',
      entityType: target.entityType,
      entityId: saved.entityId,
      metadata: { reason: input.reason, mutations: input.mutations.length },
    });

    return {
      entityId: saved.entityId,
      versionNumber: saved.versionNumber,
      adjustments: applied.adjustments,
      rejected: applied.rejected,
    };
  }
}
