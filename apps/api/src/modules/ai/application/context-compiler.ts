import {
  estimateTokens,
  hashContent,
  trustForKind,
  type CompiledBlock,
  type ContextBlock,
  type ContextPackage,
  type DroppedBlock,
} from '../domain/context.js';

export const CONTEXT_COMPILER_VERSION = '1.0.0';

/**
 * Ordem de emissão dos blocos.
 *
 * Fixa de propósito: o prefixo estável precisa ser byte-idêntico entre chamadas
 * para o cache do provider acertar. Ordem que varia = cache que nunca acerta.
 */
const KIND_ORDER = ['POLICY', 'STABLE', 'KNOWLEDGE', 'DYNAMIC', 'UNTRUSTED'] as const;

export interface CompileContextInput {
  blocks: ContextBlock[];
  tokenBudget: number;
}

/**
 * Context Compiler (§9).
 *
 * "Máxima informação útil com o mínimo de contexto possível." Quando o
 * orçamento estoura, corta pelos blocos de menor prioridade — e REGISTRA o que
 * cortou. Corte silencioso produz resposta ruim sem explicação.
 */
export class ContextCompiler {
  compile(input: CompileContextInput): ContextPackage {
    const compiled: CompiledBlock[] = input.blocks.map((block) => ({
      ...block,
      // A confiança é derivada do tipo, nunca aceita do chamador: se pudesse
      // ser informada, um bloco UNTRUSTED marcado como TRUSTED por engano
      // atravessaria a segregação do Prompt Compiler.
      trust: trustForKind(block.kind),
      tokensEstimate: estimateTokens(block.content),
      contentHash: hashContent(block.content),
    }));

    const { kept, dropped } = this.applyBudget(compiled, input.tokenBudget);

    kept.sort((a, b) => {
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (byKind !== 0) return byKind;
      // Dentro do mesmo tipo, maior prioridade primeiro; empate resolve por id
      // para a ordem ser determinística.
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });

    return {
      blocks: kept,
      dropped,
      tokenBudget: input.tokenBudget,
      tokensEstimate: kept.reduce((total, block) => total + block.tokensEstimate, 0),
    };
  }

  private applyBudget(
    blocks: CompiledBlock[],
    budget: number,
  ): { kept: CompiledBlock[]; dropped: DroppedBlock[] } {
    const total = blocks.reduce((sum, block) => sum + block.tokensEstimate, 0);
    if (total <= budget) return { kept: blocks, dropped: [] };

    // Menor prioridade sai primeiro — mas ESSENCIAL não sai nunca, e essa é uma
    // pergunta diferente da ordem em que o bloco aparece.
    //
    // POLICY também era protegida incondicionalmente, e isso se virou contra o
    // produto: as seções da policy só crescem, e a cada uma que entrava sobrava
    // menos espaço para o que a operação existe para tocar. Medido num ajuste
    // real: 9.868 tokens de policy num teto de 18.000 empurraram para fora o
    // `agent.core` — o OS reconfigurou um agente sem enxergar o agente — e o
    // contrato de saída junto. A policy orienta; o alvo É a operação. Entre
    // perder uma seção de orientação e perder o próprio alvo, perde-se a seção.
    const candidates = [...blocks].sort(
      (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
    );

    const dropped: DroppedBlock[] = [];
    const removed = new Set<string>();
    let current = total;

    // O bloco de MAIOR prioridade nunca sai, essencial ou não. Cortar todos
    // produz uma chamada cega que "funciona": o roteador passou a decidir só
    // com a frase do usuário — 10 tokens de entrada — e perguntava ao usuário
    // o que o contexto cortado dizia. Um prompt acima do teto é caro; um
    // prompt vazio é errado.
    const maisImportante = candidates.at(-1);

    for (const block of candidates) {
      if (current <= budget) break;
      if (block.essential) continue;
      if (block === maisImportante) continue;

      removed.add(block.id);
      dropped.push({
        id: block.id,
        kind: block.kind,
        tokensEstimate: block.tokensEstimate,
        reason: 'TOKEN_BUDGET',
      });
      current -= block.tokensEstimate;
    }

    // Cabendo só o essencial, ainda assim ele vai INTEIRO. Um prompt um pouco
    // acima do teto é caro; um prompt sem o alvo é uma operação cega, que é
    // pior — e o teto é nosso, não do provider.
    return { kept: blocks.filter((block) => !removed.has(block.id)), dropped };
  }
}
