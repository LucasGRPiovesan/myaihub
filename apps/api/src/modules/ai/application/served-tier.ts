/**
 * Qual cota SERVIU a última chamada — o fato, não a previsão.
 *
 * O adapter sabe qual chave ele TENTARIA agora, e isso reinicia junto do
 * processo: depois de um restart ele volta a supor que a cota gratuita está de
 * pé. Enquanto essa suposição valia como verdade, duas coisas mentiam ao mesmo
 * tempo — a Topbar dizia "cota gratuita" com as chamadas saindo pela paga, e o
 * seletor de modelo ficava travado como se ainda houvesse cota para respeitar.
 *
 * Isto guarda o que ACONTECEU. É alimentado a cada chamada registrada e semeado
 * no boot a partir de `ai_calls`, para já estar certo antes do primeiro turno.
 */
export class ServedTierObserver {
  private ultima: 'FREE' | 'PAID' | null = null;

  record(tier: 'FREE' | 'PAID' | undefined): void {
    if (tier) this.ultima = tier;
  }

  /** `null` enquanto nenhuma chamada tiver sido observada nem semeada. */
  last(): 'FREE' | 'PAID' | null {
    return this.ultima;
  }
}
