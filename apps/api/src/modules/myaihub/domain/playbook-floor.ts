import { AGENT_FACET_MUTATION, type AgentFacet } from '@myaihub/shared';
import type { AgentPlaybook } from './playbook.js';

/**
 * O piso do ofício, na forma de mutações canônicas.
 *
 * Princípio já declara a faceta — foi para isso que ela entrou no schema — e o
 * mapa faceta→mutação vem de `@myaihub/shared`, o mesmo que o painel usa.
 * Anti-padrão é proibição por natureza: vai para `limits` em HARD, porque um
 * "NUNCA" do ofício que nascesse como preferência não seria o mesmo "NUNCA".
 *
 * Vive no DOMÍNIO porque tem dois consumidores que não se conhecem: a criação
 * de agente, dentro do runner, e a sincronização pelo ofício, que é rota e não
 * passa por modelo nenhum.
 */
/** A forma de uma mutação do piso, tipada — o teste faz `as` sobre ela. */
export interface FloorMutation {
  kind: string;
  semanticKey: string;
  label: string;
  statement: string;
  enforcement: string;
  origin: string;
  rationale: string;
}

export function playbookFloorMutations(playbooks: readonly AgentPlaybook[]): FloorMutation[] {
  // A CHAVE SEMÂNTICA É ÚNICA NO PISO, e a primeira ocorrência vence.
  //
  // A conduta universal entra antes do ofício. Quando os dois declaram o mesmo
  // conceito, aplicar os dois faz o segundo sobrescrever o primeiro EM
  // SILÊNCIO: aconteceu de verdade — o princípio curado de 682 caracteres do
  // piso virou uma paráfrase de 335 escrita pelo OS no playbook do papel, e o
  // agente recebeu a versão pior sem nada acusar.
  //
  // Manter a primeira é manter a conduta: ela vale para todo agente e é a que
  // não pode ser enfraquecida por um papel específico.
  const vistas = new Set<string>();

  const unica = <T extends { semanticKey: string }>(itens: readonly T[]): T[] =>
    itens.filter((item) => {
      if (vistas.has(item.semanticKey)) return false;
      vistas.add(item.semanticKey);
      return true;
    });

  return playbooks.flatMap((playbook) => [
    ...unica(playbook.principles).map((principle) => ({
      kind: AGENT_FACET_MUTATION[principle.facet as AgentFacet],
      semanticKey: principle.semanticKey,
      label: principle.label,
      statement: principle.statement,
      // Ausente significa orientação: o modelo pondera. Declarado HARD, o
      // princípio sobe para o bloco inegociável do prompt do agente.
      enforcement: principle.enforcement ?? 'SOFT',
      origin: 'INFERRED_BASELINE',
      rationale: `Piso do ofício "${playbook.label}".`,
    })),
    ...unica(playbook.antiPatterns).map((limite) => ({
      kind: AGENT_FACET_MUTATION.limits,
      semanticKey: limite.semanticKey,
      label: limite.label,
      statement: limite.statement,
      enforcement: 'HARD',
      origin: 'INFERRED_BASELINE',
      rationale: `Limite do ofício "${playbook.label}".`,
    })),
  ]);
}

/**
 * O piso atualiza o TEXTO, nunca rebaixa a força.
 *
 * Princípio de playbook não declara `enforcement` — quem decide é o modelo, ao
 * projetar o agente, ou o usuário depois. Aplicar o piso com SOFT fixo desfazia
 * essa decisão: um item que estava HARD caía para SOFT e SAÍA do bloco de
 * regras inegociáveis do prompt, enfraquecendo em silêncio a regra que a
 * sincronização deveria estar reforçando.
 *
 * É a mesma garantia do `guardAgainstRegression` — "enforcement rebaixado sem
 * pedido é desfeito" — aplicada onde não há um turno de modelo para guardar.
 */
export function preserveEnforcement<T extends { kind: string }>(
  mutations: ReadonlyArray<T>,
  canonical: Record<string, unknown>,
): T[] {
  const forca = new Map<string, string>();

  for (const itens of Object.values(canonical)) {
    if (!Array.isArray(itens)) continue;
    for (const item of itens as Array<{ semanticKey?: string; enforcement?: string }>) {
      if (item.semanticKey && item.enforcement) forca.set(item.semanticKey, item.enforcement);
    }
  }

  const ordem: Record<string, number> = { SOFT: 0, HARD: 1, DETERMINISTIC: 2 };

  return mutations.map((mutation) => {
    const alvo = mutation as { semanticKey?: string; enforcement?: string };
    const atual = alvo.semanticKey ? forca.get(alvo.semanticKey) : undefined;
    if (!atual || !alvo.enforcement) return mutation;

    // DETERMINISTIC exige checker registrado, e o piso não traz um: manter o
    // que já está lá seria prometer verificação em código que não existe.
    const preservado = atual === 'DETERMINISTIC' ? 'HARD' : atual;

    return (ordem[preservado] ?? 0) > (ordem[alvo.enforcement] ?? 0)
      ? ({ ...mutation, enforcement: preservado } as T)
      : mutation;
  });
}
