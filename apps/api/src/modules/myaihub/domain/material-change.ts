/**
 * Este turno mudou alguma coisa que o usuário possa SENTIR?
 *
 * Versão nova que não muda o que o agente lê é pior que nenhuma versão: o painel
 * diz "ajustei", o número sobe, o histórico ganha mais uma linha — e o teste
 * seguinte devolve exatamente o mesmo erro. O usuário testa, vê o mesmo
 * comportamento, e passa a duvidar de tudo o que o painel afirma depois disso.
 *
 * Medido neste sistema, num agente só: de nove ajustes, DOIS gravaram versão sem
 * nenhuma diferença no prompt compilado (v6 e v8), e a única coisa que separava
 * a v5 da v6 era `source: MYAIHUB_BASELINE → USER` no mesmo item, com o mesmo
 * texto. O usuário tinha acabado de perguntar "você ajustou o que eu já havia te
 * pedido?" — e recebeu uma versão nova como se a resposta fosse sim.
 *
 * O que conta como mudança é o que chega ao agente ou à tela: `label`,
 * `statement`, `enforcement`, `check`, quais itens existem, e todo campo escalar
 * de configuração (identidade, objetivo, abertura, cor...). O resto é
 * escrituração — carimbo de quando, de quem e por quê —, e escrituração não é
 * motivo para anunciar uma alteração que não houve.
 */

/**
 * Campos que descrevem a GRAVAÇÃO, não a configuração.
 *
 * `rationale` e `source` são proveniência: dizem por que o item está ali e quem
 * o escreveu. São informação legítima e continuam sendo gravados — só não
 * significam, sozinhos, que alguma coisa mudou para quem usa o agente.
 */
const BOOKKEEPING = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'rationale',
  'source',
  'origin',
  'originHubMessageId',
  // Carimbo de "até que versão do ofício este agente viu". Muda sozinho a cada
  // operação, sem que ninguém tenha pedido nada.
  'playbookVersion',
]);

/** `true` quando o documento passa a dizer algo diferente ao agente ou à tela. */
export function changesConfiguration(before: unknown, after: unknown): boolean {
  return signature(before) !== signature(after);
}

/**
 * Assinatura estável do documento, sem escrituração.
 *
 * Ordena as chaves porque a ordem de propriedade de um objeto reconstruído por
 * `structuredClone` ou por JSON não é garantida — comparar texto bruto acusaria
 * diferença onde não há nenhuma.
 */
function signature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(signature).join(',')}]`;

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !BOOKKEEPING.has(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${signature(item)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}
