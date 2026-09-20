import {
  AGENT_FACET_CODES,
  AGENT_SEMANTIC_KEY_PREFIXES,
  assertEnforcementCoherent,
  buildCode,
  canonicalAgentV1Schema,
  renumberCodes,
  type AgentFacet,
  type CanonicalAgent,
  type CanonicalItem,
} from '@myaihub/shared';
import { AppError } from '../../../shared/domain/errors.js';
import {
  reconcileCheck,
  type ApplyMutationsResult,
  type MutationContext,
  type MutationRejection,
} from '../../myaihub/domain/mutation-applier.js';
import { AGENT_MUTATION_FACET, type AgentMutation, type AgentMutationKind } from './mutations.js';

export type ApplyAgentMutationsResult = ApplyMutationsResult<CanonicalAgent, AgentMutation>;

/**
 * Aplica mutações ao Agent Core canônico.
 *
 * As invariantes do §7.2 vivem aqui, em CÓDIGO. A que mais importa: upsert com
 * `semanticKey` já existente FUNDE no item, preservando o id técnico — é o que
 * transforma "quero Philips mais objetivo" seguido de "e menos prolixo" em UM
 * item refinado, e não em dois itens que se contradizem depois.
 */
export class AgentMutationApplier {
  apply(
    current: CanonicalAgent,
    mutations: AgentMutation[],
    context: MutationContext<AgentMutationKind>,
  ): ApplyAgentMutationsResult {
    let agent: CanonicalAgent = structuredClone(current);
    const applied: AgentMutation[] = [];
    const rejected: MutationRejection[] = [];
    const adjustments: string[] = [];

    for (const mutation of mutations) {
      if (!context.allowedMutations.includes(mutation.kind)) {
        // Fronteira da operação: uma operação sobre comunicação não altera
        // limites, mesmo que o modelo proponha (§7.2).
        rejected.push({
          kind: mutation.kind,
          reason: `Mutação fora do escopo desta operação (permitidas: ${context.allowedMutations.join(', ')}).`,
        });
        continue;
      }

      try {
        agent = this.applyOne(agent, mutation, context, adjustments);
        applied.push(mutation);
      } catch (error) {
        rejected.push({
          kind: mutation.kind,
          reason: error instanceof Error ? error.message : 'Falha ao aplicar mutação.',
        });
      }
    }

    const parsed = canonicalAgentV1Schema.safeParse(agent);
    if (!parsed.success) {
      throw new AppError(
        'CANONICAL_SCHEMA_INVALID',
        'A configuração resultante não é um Agent Core válido.',
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
    agent: CanonicalAgent,
    mutation: AgentMutation,
    context: MutationContext<AgentMutationKind>,
    adjustments: string[],
  ): CanonicalAgent {
    if (mutation.kind === 'SET_AGENT_IDENTITY') {
      return {
        ...agent,
        identity: {
          ...agent.identity,
          ...(mutation.name !== undefined ? { name: mutation.name } : {}),
          ...(mutation.role !== undefined ? { role: mutation.role } : {}),
          ...(mutation.archetype !== undefined ? { archetype: mutation.archetype } : {}),
        },
      };
    }

    if (mutation.kind === 'SET_AGENT_OBJECTIVE') {
      return {
        ...agent,
        objective: {
          ...agent.objective,
          ...(mutation.primary !== undefined ? { primary: mutation.primary } : {}),
          ...(mutation.secondary !== undefined ? { secondary: mutation.secondary } : {}),
        },
      };
    }

    if (mutation.kind === 'SET_AGENT_ENGAGEMENT') {
      const engagement = {
        ...agent.engagement,
        ...(mutation.initiator !== undefined ? { initiator: mutation.initiator } : {}),
        ...(mutation.openerMode !== undefined ? { openerMode: mutation.openerMode } : {}),
        ...(mutation.opener !== undefined ? { opener: mutation.opener } : {}),
        ...(mutation.openerGuidance !== undefined
          ? { openerGuidance: mutation.openerGuidance }
          : {}),
        ...(mutation.suggestedRepliesEnabled !== undefined
          ? { suggestedRepliesEnabled: mutation.suggestedRepliesEnabled }
          : {}),
        ...(mutation.visualBlocksEnabled !== undefined
          ? { visualBlocksEnabled: mutation.visualBlocksEnabled }
          : {}),
      };

      // Roteiro sem texto não é roteiro. Sem esta correção o agente abriria
      // a conversa em silêncio — e o painel diria que a abertura está definida.
      if (engagement.openerMode === 'SCRIPTED' && !engagement.opener.trim()) {
        engagement.openerMode = 'ADAPTIVE';
        adjustments.push(
          'Abertura marcada como roteiro fixo mas sem texto: passou a ser adaptativa.',
        );
      }

      return { ...agent, engagement };
    }

    if (mutation.kind === 'REMOVE_AGENT_ITEM') {
      const facet = mutation.facet as AgentFacet;
      const items = agent[facet];
      const target = items.find((item) => item.id === mutation.itemId);

      if (!target) {
        throw new Error(`Item "${mutation.itemId}" não existe em "${facet}".`);
      }
      if (target.source === 'USER' && context.source !== 'USER') {
        // O OS não apaga o que o usuário definiu sem pedido explícito (§65).
        throw new Error(
          `O item "${target.code}" foi definido pelo usuário; remoção exige pedido explícito.`,
        );
      }

      return {
        ...agent,
        [facet]: renumberCodes(
          AGENT_FACET_CODES[facet],
          items.filter((item) => item.id !== mutation.itemId),
        ),
      };
    }

    const facet = AGENT_MUTATION_FACET[mutation.kind];
    if (!facet) throw new Error(`Mutação "${mutation.kind}" sem faceta alvo.`);

    return this.upsert(agent, facet, mutation, context, adjustments);
  }

  private upsert(
    agent: CanonicalAgent,
    facet: AgentFacet,
    mutation: Extract<AgentMutation, { semanticKey: string }>,
    context: MutationContext<AgentMutationKind>,
    adjustments: string[],
  ): CanonicalAgent {
    const expectedPrefix = AGENT_SEMANTIC_KEY_PREFIXES[facet];
    let semanticKey = mutation.semanticKey;

    if (!semanticKey.startsWith(`${expectedPrefix}.`)) {
      // Prefixo errado é erro de forma, não de conteúdo: corrigir preserva a
      // ideia que o modelo capturou. Descartar perderia a intenção do usuário
      // por causa de uma convenção de nomenclatura.
      const suffix = semanticKey.includes('.')
        ? semanticKey.split('.').slice(1).join('.')
        : semanticKey;
      semanticKey = `${expectedPrefix}.${suffix}`;
      adjustments.push(
        `A chave "${mutation.semanticKey}" não pertence a "${facet}"; corrigi para "${semanticKey}".`,
      );
    }

    const enforced = reconcileCheck(context, mutation, mutation.label, adjustments);

    const items = [...agent[facet]];
    const timestamp = context.now.toISOString();
    const existingIndex = items.findIndex((item) => item.semanticKey === semanticKey);

    const base = {
      semanticKey,
      label: mutation.label,
      statement: mutation.statement,
      enforcement: enforced.enforcement,
      ...(enforced.check ? { check: enforced.check } : {}),
      ...(mutation.rationale ? { rationale: mutation.rationale } : {}),
      updatedAt: timestamp,
    };

    // A origem que o modelo declarou tem precedência sobre o modo da operação:
    // numa criação quase tudo é inferido, mas o que o usuário DISSE precisa
    // continuar marcado como dele.
    const source =
      mutation.origin === 'USER_DIRECTED'
        ? 'USER'
        : mutation.origin === 'INFERRED_BASELINE'
          ? 'MYAIHUB_BASELINE'
          : context.source;

    if (existingIndex >= 0) {
      const existing = items[existingIndex]!;
      // Preserva o id técnico: o item é o MESMO, refinado (§5.1).
      // Baseline que o usuário depois ajustou vira intenção DELE: a partir daí
      // o OS não pode mais tratar aquele item como palpite próprio.
      const merged: CanonicalItem = {
        ...existing,
        ...base,
        source: source === 'USER' ? 'USER' : existing.source,
      };
      // Item que deixou de ser determinístico precisa perder o checker herdado.
      if (!enforced.check) delete merged.check;
      assertEnforcementCoherent(merged);
      items[existingIndex] = merged;
    } else {
      const created: CanonicalItem = {
        id: context.nextId(),
        code: buildCode(AGENT_FACET_CODES[facet], items.length + 1),
        ...base,
        source,
        ...(context.originHubMessageId ? { originHubMessageId: context.originHubMessageId } : {}),
        createdAt: timestamp,
      };
      assertEnforcementCoherent(created);
      items.push(created);
    }

    return { ...agent, [facet]: renumberCodes(AGENT_FACET_CODES[facet], items) };
  }
}
