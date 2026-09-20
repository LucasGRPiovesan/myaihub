/**
 * A cotação do dólar, para o usuário ver o gasto na moeda dele.
 *
 * O custo é calculado e GRAVADO em micros de dólar, e continua sendo: o preço
 * do provider é em dólar, e converter na gravação congelaria uma cotação dentro
 * de um dado histórico que ninguém poderia recalcular depois. A conversão é de
 * EXIBIÇÃO — acontece na leitura, com a cotação de hoje.
 */
export interface ExchangeRate {
  /** Quantos reais vale um dólar. */
  brlPerUsd: number;
  /** Quando a cotação foi publicada pela fonte. */
  quotedAt: string;
  /** Quem publicou. Aparece na tela: número de dinheiro sem origem não serve. */
  source: string;
  /**
   * A cotação está velha (a fonte não respondeu na última tentativa).
   *
   * Continua sendo exibida — um valor de ontem é muito melhor que um traço —,
   * mas a tela pode dizer que é de ontem.
   */
  stale: boolean;
}

export interface ExchangeRateProvider {
  /**
   * NUNCA vai à rede no caminho do usuário.
   *
   * Devolve o que está em memória; a atualização acontece por trás, quando o
   * valor envelhece. Uma requisição de cotação por requisição de tela seria a
   * troca errada nos dois sentidos: soma latência ao usuário e bate na fonte
   * milhares de vezes por dia para receber o mesmo número.
   */
  current(): ExchangeRate;
}
