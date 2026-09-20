/**
 * Quanto custou, na moeda de quem está lendo.
 *
 * O custo é gravado em micros de DÓLAR — é a moeda em que o provider cobra, e
 * converter na gravação congelaria uma cotação dentro de um dado histórico que
 * ninguém conseguiria recalcular depois. A conversão é de exibição e acontece
 * aqui, com a cotação de hoje, vinda do PTAX.
 *
 * Os valores por turno são MUITO pequenos — um ajuste custa cerca de R$ 0,015 —
 * e arredondar para centavos transformaria quase toda operação em "R$ 0,00", que
 * é a maneira mais rápida de ensinar o usuário a ignorar o número. Abaixo de um
 * centavo, mostra-se a fração; acima, o formato normal de dinheiro.
 */

export interface ExchangeRateView {
  brlPerUsd: number;
  quotedAt: string;
  source: string;
  stale: boolean;
}

/** Reais, com precisão suficiente para o valor não virar zero. */
export function formatBrl(micros: number, rate: ExchangeRateView | undefined): string {
  if (micros === 0) return 'sem custo';
  if (!rate) return formatUsd(micros);

  const reais = (micros / 1_000_000) * rate.brlPerUsd;

  if (reais < 0.01) {
    return `R$ ${reais.toFixed(4).replace('.', ',')}`;
  }

  return reais.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** O valor original, em dólar — vai no `title`, para a conta ser conferível. */
export function formatUsd(micros: number): string {
  if (micros === 0) return 'sem custo';
  const dollars = micros / 1_000_000;
  return `US$ ${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}

/** "US$ 0,0026 · PTAX 5,1253 de 04/09" — a origem do número, ao passar o mouse. */
export function costTitle(micros: number, rate: ExchangeRateView | undefined): string {
  if (!rate) return formatUsd(micros);

  const dia = rate.quotedAt.slice(0, 10).split('-').reverse().join('/');
  const cotacao = rate.brlPerUsd.toFixed(4).replace('.', ',');

  return `${formatUsd(micros)} · dólar a R$ ${cotacao}${dia ? ` (${dia})` : ''}${
    rate.stale ? ' · cotação desatualizada' : ''
  } · ${rate.source}`;
}
