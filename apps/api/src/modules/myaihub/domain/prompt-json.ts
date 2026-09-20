/**
 * O canônico como o MODELO precisa ler — não como o banco guarda.
 *
 * Ia com `JSON.stringify(canonical, null, 2)`: indentação de dois espaços e
 * todos os campos de escrituração. Medido num agente de 12 itens: 2.384 tokens,
 * e boa parte era espaço em branco, carimbo de data e id de mensagem — nada
 * que o modelo use para decidir. O que ele usa fica: `id` (a remoção aponta
 * por ele), `code`, `semanticKey` (é o que faz refinar no lugar em vez de
 * duplicar), `label`, `statement`, `enforcement`, `check` e `source` (baseline
 * inferida cede à intenção explícita, e só dá para saber qual é qual lendo).
 *
 * `rationale` sai também: é a explicação para o USUÁRIO de por que um item
 * inferido existe, e o modelo não precisa dela para refinar o item.
 */
const BOOKKEEPING = new Set(['createdAt', 'updatedAt', 'originHubMessageId', 'rationale']);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (BOOKKEEPING.has(key)) continue;
    // Vazio não informa nada e custa a chave inteira.
    if (inner === undefined || inner === null || inner === '') continue;
    if (Array.isArray(inner) && inner.length === 0) continue;
    out[key] = strip(inner);
  }
  return out;
}

export function promptJson(value: unknown): string {
  return JSON.stringify(strip(value));
}
