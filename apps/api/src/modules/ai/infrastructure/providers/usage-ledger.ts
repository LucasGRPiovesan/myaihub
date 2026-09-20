import type { NormalizedUsage } from '@myaihub/shared';

/**
 * O consumo de UMA chamada lógica, somado por TENTATIVA — e só com o que o
 * provider reportou.
 *
 * Um pedido que trava é abortado e refeito — sequencialmente, depois da falha.
 * O que travou consumiu o prompt antes de emudecer, e sem somá-lo o sistema
 * exibiria menos do que a fatura vai cobrar, justamente no número que existe
 * para o usuário saber quanto está gastando.
 *
 * A tentação era estimar — "o descartado tinha o mesmo prompt, some o input de
 * novo". Isso é chute com aparência de conta, e num número de dinheiro chute é
 * pior que ausência: ninguém consegue conferir, e ninguém sabe que precisa.
 *
 * Aqui só entra `usageMetadata` que o Gemini mandou. O stream reporta o consumo
 * ACUMULADO em cada pedaço, então cada tentativa é registrada pelo ÚLTIMO valor
 * que ela chegou a informar — a que morreu no meio conta o que consumiu até
 * morrer; a que nunca disse nada não entra, porque o provider nunca afirmou que
 * ela consumiu algo.
 *
 * A consequência é assumida: se o Google cobrar um pedido que abortamos antes de
 * ele reportar qualquer coisa, o total sai a menos. Preferimos ficar a menos
 * COM origem a ficar "certo" com um número que inventamos.
 */
export class UsageLedger {
  /** Última leitura de cada tentativa. A chave é o índice da tentativa. */
  private readonly porTentativa = new Map<number, NormalizedUsage>();

  /**
   * Registra o que o provider informou nesta tentativa.
   *
   * Sobrescreve de propósito: o valor do stream é acumulado, então a leitura
   * mais recente já contém as anteriores. Somar pedaço a pedaço contaria o
   * mesmo token muitas vezes.
   */
  record(attempt: number, usage: NormalizedUsage): void {
    this.porTentativa.set(attempt, usage);
  }

  /** Quantas tentativas chegaram a reportar consumo. */
  get reported(): number {
    return this.porTentativa.size;
  }

  /**
   * O consumo da chamada inteira.
   *
   * Tokens somam — foram gastos de verdade, em pedidos diferentes. A LATÊNCIA
   * não: as tentativas correram em paralelo, e somá-las daria um tempo que
   * ninguém esperou. Vale a do turno, que é a de quem venceu.
   */
  total(latencyMs: number): NormalizedUsage {
    const soma: NormalizedUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      toolCalls: 0,
      totalTokens: 0,
      latencyMs,
    };

    for (const usage of this.porTentativa.values()) {
      soma.inputTokens += usage.inputTokens;
      soma.cachedInputTokens += usage.cachedInputTokens;
      soma.cacheWriteTokens += usage.cacheWriteTokens;
      soma.outputTokens += usage.outputTokens;
      soma.reasoningTokens += usage.reasoningTokens;
      soma.toolCalls += usage.toolCalls;
      soma.totalTokens += usage.totalTokens;
    }

    return soma;
  }
}
