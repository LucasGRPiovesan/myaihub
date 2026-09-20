import type { CanonicalItem } from '@myaihub/shared';

/**
 * Refinar NUNCA pode entregar menos do que já existia (§65).
 *
 * A policy pede isso ao modelo, mas policy orienta julgamento — não garante.
 * Um ajuste que devolve `statement` mais curto, apaga item sem pedido ou zera o
 * objetivo é regressão silenciosa: o usuário pediu "melhora isso" e recebeu uma
 * configuração pior, sem nada na tela dizendo que piorou.
 *
 * O tratamento aqui é RESTAURAR, não recusar. Recusar perderia também o que veio
 * de bom no mesmo turno; restaurar mantém o ganho e desfaz só a perda — e avisa,
 * porque uma correção silenciosa seria outro tipo de mentira.
 */

/** Documento canônico com facetas de itens, visto de forma genérica. */
type FacetedDocument = Record<string, unknown>;

export interface RegressionGuardInput<T extends FacetedDocument> {
  before: T;
  after: T;
  /** Facetas que carregam `CanonicalItem[]`. */
  facets: readonly string[];
  /**
   * `semanticKey` que o usuário mandou remover de verdade.
   *
   * Remoção pedida não é regressão — é o usuário exercendo controle sobre a
   * própria configuração.
   */
  removedKeys: ReadonlySet<string>;
}

export interface RegressionGuardResult<T> {
  canonical: T;
  /** O que foi restaurado, em linguagem de usuário. Vira VALUE_ADJUSTED. */
  restored: string[];
}

function itemsOf(document: FacetedDocument, facet: string): CanonicalItem[] {
  const value = document[facet];
  return Array.isArray(value) ? (value as CanonicalItem[]) : [];
}

/**
 * Devolve o documento com as perdas desfeitas.
 *
 * Três perdas são tratadas, e são as três que aparecem na prática:
 *
 *   1. item que sumiu sem remoção pedida;
 *   2. `statement` que encolheu — trocar instrução detalhada por adjetivo parece
 *      arrumação e é perda de precisão, que é o que faz o agente funcionar;
 *   3. `enforcement` rebaixado sem pedido — uma regra obrigatória que vira
 *      preferência deixa de valer sem ninguém perceber.
 */
export function guardAgainstRegression<T extends FacetedDocument>(
  input: RegressionGuardInput<T>,
): RegressionGuardResult<T> {
  const restored: string[] = [];
  const result = structuredClone(input.after);

  guardOpening(input.before, result, restored);

  for (const facet of input.facets) {
    const before = itemsOf(input.before, facet);
    if (before.length === 0) continue;

    const after = itemsOf(result, facet);
    const byKey = new Map(after.map((item) => [item.semanticKey, item]));
    let changed = false;

    for (const original of before) {
      if (input.removedKeys.has(original.semanticKey)) continue;

      const current = byKey.get(original.semanticKey);

      if (!current) {
        after.push(original);
        byKey.set(original.semanticKey, original);
        restored.push(`"${original.label}" sumiria do agente; mantive.`);
        changed = true;
        continue;
      }

      // Encolher o texto é perder precisão. A margem de 15% evita acusar
      // reescrita legítima que ficou um pouco mais enxuta.
      if (current.statement.length < original.statement.length * 0.85) {
        current.statement = original.statement;
        restored.push(`"${original.label}" perderia detalhe na descrição; mantive a anterior.`);
        changed = true;
      }

      if (rank(original.enforcement) > rank(current.enforcement)) {
        current.enforcement = original.enforcement;
        if (original.check) current.check = original.check;
        restored.push(`"${original.label}" seria rebaixada de ${original.enforcement}; mantive.`);
        changed = true;
      }
    }

    if (changed) {
      (result as FacetedDocument)[facet] = after;
    }
  }

  return { canonical: result, restored };
}

/**
 * A abertura é a única parte do agente que NÃO é um item canônico.
 *
 * `engagement` é um objeto de campos escalares, então nada do guard de itens
 * alcança: um ajuste que só falava de outra coisa podia devolver a diretriz de
 * abertura vazia, e ela sumia sem aviso. Na prática isso apareceu como o
 * usuário corrigindo a mesma abertura de novo a cada rodada — o que ele tinha
 * estabelecido antes não sobrevivia ao ajuste seguinte.
 */
function guardOpening(before: FacetedDocument, after: FacetedDocument, restored: string[]): void {
  const previous = before['engagement'] as Record<string, string> | undefined;
  const current = after['engagement'] as Record<string, string> | undefined;
  if (!previous || !current) return;

  current['openerGuidance'] = keepNonEmpty(
    previous['openerGuidance'] ?? '',
    current['openerGuidance'] ?? '',
    'A orientação de abertura',
    restored,
  );

  // Um roteiro literal só some quando alguém troca o modo de propósito.
  if (previous['openerMode'] === 'SCRIPTED' && current['openerMode'] === 'SCRIPTED') {
    current['opener'] = keepNonEmpty(
      previous['opener'] ?? '',
      current['opener'] ?? '',
      'A saudação fixa',
      restored,
    );
  }
}

function rank(enforcement: string): number {
  if (enforcement === 'DETERMINISTIC') return 3;
  if (enforcement === 'HARD') return 2;
  return 1;
}

/**
 * Campos de texto único que não podem ser esvaziados por um ajuste.
 *
 * `SET_AGENT_OBJECTIVE` com string vazia apagaria o objetivo inteiro — e o
 * modelo produz isso quando interpreta "reescreve" como "começa do zero".
 */
export function keepNonEmpty(
  before: string,
  after: string,
  label: string,
  restored: string[],
): string {
  if (before.trim() && !after.trim()) {
    restored.push(`${label} seria apagado; mantive o anterior.`);
    return before;
  }
  return after;
}
