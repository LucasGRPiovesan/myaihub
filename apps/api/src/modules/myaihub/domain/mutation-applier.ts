import {
  assertEnforcementCoherent,
  buildCode,
  canonicalProjectProfileV2Schema,
  PROJECT_FACET_CODES,
  PROJECT_SEMANTIC_KEY_PREFIXES,
  PROJECT_TYPES,
  renumberCodes,
  type CanonicalItem,
  type CanonicalProjectProfile,
  type EnforcementLevel,
  type ProjectFacet,
  type RuleCheckRef,
} from '@myaihub/shared';
import { AppError } from '../../../shared/domain/errors.js';
import { toRuleCheckRef, type LlmRuleCheck } from './llm-rule-check.js';
import type { RuleCheckValidation } from './rule-checks.js';
import {
  MUTATION_TARGET_FACET,
  type CanonicalMutation,
  type CanonicalMutationKind,
} from './mutations.js';

export interface MutationRejection {
  kind: string;
  reason: string;
}

export interface ApplyMutationsResult<TCanonical, TMutation> {
  canonical: TCanonical;
  applied: TMutation[];
  rejected: MutationRejection[];
  /**
   * Valores corrigidos para caber no vocabulário, sem descartar a mutação.
   *
   * Distinto de `rejected`: ali nada foi aplicado; aqui foi aplicado com um
   * ajuste que o usuário precisa saber que aconteceu.
   */
  adjustments: string[];
}

export interface MutationContext<TKind extends string = string> {
  allowedMutations: readonly TKind[];
  now: Date;
  nextId: () => string;
  originHubMessageId?: string;
  /** USER quando o usuário pediu explicitamente; MYAIHUB quando o OS inferiu. */
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  /** Valida o checker contra o DeterministicRuleCheckRegistry (§6.1). */
  validateCheck: (ref: RuleCheckRef) => RuleCheckValidation;
}

/**
 * Reconcilia `enforcement` + `check` de um item proposto pelo modelo.
 *
 * O checker é um campo ACESSÓRIO: o conteúdo da regra é o que o usuário disse.
 * Descartar o item inteiro porque o modelo citou um checker inexistente perde a
 * intenção dele por causa de metadado — foi exatamente o que aconteceu com
 * "presence_check" e "default". Aqui o item entra, rebaixado a HARD, e o
 * usuário é avisado.
 *
 * O que NÃO é negociável: DETERMINISTIC só sobrevive com um checker de verdade,
 * registrado e com params válidos. Senão o selo "verificada em código" mentiria.
 */
export function reconcileCheck(
  context: MutationContext<string>,
  proposed: { enforcement: EnforcementLevel; check?: LlmRuleCheck | undefined },
  itemLabel: string,
  adjustments: string[],
): { enforcement: EnforcementLevel; check?: RuleCheckRef } {
  if (!proposed.check) {
    if (proposed.enforcement === 'DETERMINISTIC') {
      adjustments.push(
        `"${itemLabel}" foi marcada como verificável em código sem indicar o checker; ` +
          'registrei como regra obrigatória.',
      );
      return { enforcement: 'HARD' };
    }
    return { enforcement: proposed.enforcement };
  }

  const validation = context.validateCheck(toRuleCheckRef(proposed.check));

  if (!validation.ok) {
    adjustments.push(
      `"${itemLabel}": ${validation.reason}; a regra foi mantida como obrigatória, ` +
        'mas sem verificação automática.',
    );
    return { enforcement: 'HARD' };
  }

  // Checker válido é evidência mais forte que o nível declarado: se o modelo
  // soube dizer COMO verificar, o item é verificável — mesmo que tenha escrito
  // "SOFT" no rótulo.
  return { enforcement: 'DETERMINISTIC', check: validation.check };
}

/**
 * Aplica mutações ao Project Profile canônico.
 *
 * Todas as invariantes do §7.2 vivem aqui, em CÓDIGO — não na policy textual.
 * A policy orienta julgamento; garantia estrutural é responsabilidade nossa.
 */
export class ProjectProfileMutationApplier {
  apply(
    current: CanonicalProjectProfile,
    mutations: CanonicalMutation[],
    context: MutationContext<CanonicalMutationKind>,
  ): ApplyMutationsResult<CanonicalProjectProfile, CanonicalMutation> {
    let profile: CanonicalProjectProfile = structuredClone(current);
    const applied: CanonicalMutation[] = [];
    const rejected: MutationRejection[] = [];
    const adjustments: string[] = [];

    for (const mutation of mutations) {
      if (!context.allowedMutations.includes(mutation.kind)) {
        // Fora do escopo declarado pela operação: rejeita e registra. Aplicar
        // "já que veio" seria deixar o modelo ampliar o próprio poder.
        rejected.push({
          kind: mutation.kind,
          reason: `Mutação fora do escopo desta operação (permitidas: ${context.allowedMutations.join(', ')}).`,
        });
        continue;
      }

      try {
        profile = this.applyOne(profile, mutation, context, adjustments);
        applied.push(mutation);
      } catch (error) {
        rejected.push({
          kind: mutation.kind,
          reason: error instanceof Error ? error.message : 'Falha ao aplicar mutação.',
        });
      }
    }

    // O documento inteiro é revalidado: mutações individuais válidas podem
    // compor um documento inválido (ex.: estourar o limite de itens da faceta).
    const parsed = canonicalProjectProfileV2Schema.safeParse(profile);
    if (!parsed.success) {
      throw new AppError(
        'CANONICAL_SCHEMA_INVALID',
        'O documento resultante não é um Project Profile válido.',
        {
          httpStatus: 422,
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      );
    }

    return { canonical: parsed.data, applied, rejected, adjustments };
  }

  private applyOne(
    profile: CanonicalProjectProfile,
    mutation: CanonicalMutation,
    context: MutationContext<CanonicalMutationKind>,
    adjustments: string[],
  ): CanonicalProjectProfile {
    if (mutation.kind === 'SET_PROJECT_IDENTITY') {
      const next = { ...profile };
      if (mutation.name !== undefined) next.name = mutation.name;
      if (mutation.summary !== undefined) next.summary = mutation.summary;
      if (mutation.type !== undefined) {
        const type = mutation.type.toLowerCase();
        if ((PROJECT_TYPES as readonly string[]).includes(type)) {
          next.type = type as CanonicalProjectProfile['type'];
        } else {
          // Vocabulário fechado no ARMAZENAMENTO, tolerante na ENTRADA: cai em
          // "outro" e avisa, em vez de descartar a mutação inteira. Rejeitá-la
          // levaria junto `name` e `summary` — uma classificação errada
          // destruindo a substância do que o usuário disse.
          next.type = 'outro';
          adjustments.push(
            `O tipo "${mutation.type}" não existe no vocabulário; classifiquei como "outro".`,
          );
        }
      }
      if (mutation.businessModel !== undefined || mutation.businessStage !== undefined) {
        next.business = {
          ...profile.business,
          ...(mutation.businessModel !== undefined ? { model: mutation.businessModel } : {}),
          ...(mutation.businessStage !== undefined ? { stage: mutation.businessStage } : {}),
        };
      }
      return next;
    }

    if (mutation.kind === 'REMOVE_ITEM') {
      const facet = mutation.facet as ProjectFacet;
      const items = profile[facet];
      const target = items.find((item) => item.id === mutation.itemId);

      if (!target) {
        throw new Error(`Item "${mutation.itemId}" não existe na faceta "${facet}".`);
      }
      if (target.source === 'USER' && context.source !== 'USER') {
        // O OS não apaga o que o usuário escreveu sem pedido explícito (§65).
        throw new Error(
          `O item "${target.code}" foi definido pelo usuário; remoção exige pedido explícito.`,
        );
      }

      return {
        ...profile,
        [facet]: renumberCodes(
          PROJECT_FACET_CODES[facet],
          items.filter((item) => item.id !== mutation.itemId),
        ),
      };
    }

    const facet = MUTATION_TARGET_FACET[mutation.kind] as ProjectFacet | undefined;
    if (!facet) throw new Error(`Mutação "${mutation.kind}" sem faceta alvo.`);

    return this.upsertItem(profile, facet, mutation, context, adjustments);
  }

  private upsertItem(
    profile: CanonicalProjectProfile,
    facet: ProjectFacet,
    mutation: Extract<CanonicalMutation, { semanticKey: string }>,
    context: MutationContext<CanonicalMutationKind>,
    adjustments: string[],
  ): CanonicalProjectProfile {
    const expectedPrefix = PROJECT_SEMANTIC_KEY_PREFIXES[facet];
    let semanticKey = mutation.semanticKey;

    if (!semanticKey.startsWith(`${expectedPrefix}.`)) {
      // Prefixo errado é erro de FORMA; o conteúdo é o que o usuário disse.
      // Este aplicador rejeitava o item inteiro — medido contra o modelo real,
      // um diferencial descrito no briefing sumia por causa da nomenclatura,
      // enquanto agente e campanha corrigiam o mesmo erro sem perder nada.
      const suffix = semanticKey.includes('.')
        ? semanticKey.split('.').slice(1).join('.')
        : semanticKey;
      semanticKey = `${expectedPrefix}.${suffix}`;
      adjustments.push(
        `A chave "${mutation.semanticKey}" não pertence a "${facet}"; corrigi para "${semanticKey}".`,
      );
    }

    const enforced = reconcileCheck(context, mutation, mutation.label, adjustments);

    const items = [...profile[facet]];
    const timestamp = context.now.toISOString();
    const existingIndex = items.findIndex((item) => item.semanticKey === semanticKey);

    const base = {
      semanticKey,
      label: mutation.label,
      statement: mutation.statement,
      enforcement: enforced.enforcement,
      ...(enforced.check ? { check: enforced.check } : {}),
      updatedAt: timestamp,
    };

    if (existingIndex >= 0) {
      // FUNDE no item existente, preservando o id técnico. É o que impede que
      // "seja objetivo" e "não explique demais" virem dois itens (§5.1).
      const existing = items[existingIndex]!;
      const merged: CanonicalItem = { ...existing, ...base, source: existing.source };
      // Um item que DEIXOU de ser determinístico precisa perder o checker: sem
      // isto o spread preservaria o antigo e o par enforcement/check ficaria
      // incoerente — que é justamente o que assertEnforcementCoherent barra.
      if (!enforced.check) delete merged.check;
      assertEnforcementCoherent(merged);
      items[existingIndex] = merged;
    } else {
      const created: CanonicalItem = {
        id: context.nextId(),
        code: buildCode(PROJECT_FACET_CODES[facet], items.length + 1),
        ...base,
        source: context.source,
        ...(context.originHubMessageId ? { originHubMessageId: context.originHubMessageId } : {}),
        createdAt: timestamp,
      };
      assertEnforcementCoherent(created);
      items.push(created);
    }

    return { ...profile, [facet]: renumberCodes(PROJECT_FACET_CODES[facet], items) };
  }
}
