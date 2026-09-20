/**
 * O QUE O PEDIDO É — e, por isso, que orientação ele usa.
 *
 * Toda operação carregava a policy inteira. Medido num ajuste de saudação:
 * 7.400 tokens de policy, 14 seções, mais da metade sobre situações que aquele
 * pedido não tinha. Uma seção como "relato de falha não é pedido de remoção"
 * decide muito quando há relato de falha e nada quando não há — e ocupa o
 * mesmo espaço, disputando atenção com o contrato de saída, nos dois casos.
 *
 * O S.O passa a SABER DO QUE PRECISA: quem lê a frase é o roteador, que já
 * está lendo de qualquer jeito; ele devolve os sinais, e a operação carrega as
 * seções condicionais só quando o sinal delas apareceu. Sem sinais conhecidos
 * (o roteador não rodou), carrega TUDO — o padrão seguro é o de antes.
 */
export const REQUEST_SIGNALS = ['FAILURE_REPORT', 'EXAMPLE', 'INTERLOCUTOR'] as const;
export type RequestSignal = (typeof REQUEST_SIGNALS)[number];

/**
 * Seção da policy que só se carrega quando o sinal dela aparece.
 *
 * Só entram aqui seções SITUACIONAIS — as que existem para uma forma
 * específica de pedido. Conduta, nível da informação, taxonomia e
 * apresentação valem para todo pedido e continuam sempre.
 */
export const CONDITIONAL_SECTIONS: Record<string, readonly RequestSignal[]> = {
  // Relato de falha: diagnosticar antes de mexer, e onde a correção mora.
  diagnosis: ['FAILURE_REPORT'],
  calibration_level: ['FAILURE_REPORT'],
  // "ex: ..." é propriedade, não roteiro.
  examples: ['EXAMPLE'],
  // O que a pessoa da conversa disse sobre si não vira configuração.
  ephemeral_facts: ['INTERLOCUTOR', 'FAILURE_REPORT'],
};

/**
 * As seções que ESTE pedido usa.
 *
 * `signals` indefinido = ninguém classificou o pedido: vai tudo. Conversa de
 * teste anexada conta como INTERLOCUTOR — metade dela é fala de terceiro.
 */
export function sectionsFor(
  sections: readonly string[],
  signals: readonly RequestSignal[] | undefined,
  options: { hasTestTranscript?: boolean } = {},
): string[] {
  if (!signals) return [...sections];

  const presentes = new Set<RequestSignal>(signals);
  if (options.hasTestTranscript) presentes.add('INTERLOCUTOR');

  return sections.filter((section) => {
    const exige = CONDITIONAL_SECTIONS[section];
    return !exige || exige.some((signal) => presentes.has(signal));
  });
}
