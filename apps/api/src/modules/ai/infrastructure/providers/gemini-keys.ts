/**
 * Duas chaves do MESMO provider: a gratuita primeiro, a paga só quando a
 * gratuita acabou o dia.
 *
 * ========== POR QUE NÃO EXISTE "CONSULTAR SALDO" ==========
 *
 * A pergunta óbvia é: por que não perguntar à API quanto de cota sobrou? Porque
 * a API não responde isso. A documentação de limites do Gemini descreve os
 * TETOS (RPM, TPM, RPD) e manda conferir o tier no AI Studio — uma tela, não um
 * endpoint. Não há recurso REST de saldo, e `countTokens` ou `models.list` não
 * dizem nada sobre a cota de geração: gastariam requisição para devolver a
 * mesma dúvida.
 *
 * Então a sonda tem que ser gratuita de outra forma — e a saída é não existir
 * sonda: **quem testa se o gratuito voltou é a PRÓXIMA chamada de verdade.**
 * É o padrão de circuit breaker em meio-aberto, e ele encaixa exatamente aqui:
 *
 *   · gratuita disponível  → usa a gratuita, e nada é gasto verificando;
 *   · gratuita devolve 429 → marca até quando ela está fora, e a MESMA
 *     requisição do usuário segue na paga (a retentativa do provider já faz
 *     isso), então ninguém vê erro;
 *   · passado o prazo      → a próxima chamada real volta a tentar a gratuita.
 *     Voltando, seguimos de graça; ainda fora, o 429 renova o prazo e a paga
 *     atende. O custo da verificação é ZERO porque a verificação é o trabalho.
 *
 * ========== ATÉ QUANDO ELA FICA FORA ==========
 *
 * Três fontes, nesta ordem:
 *
 *   1. `retryDelay` do próprio erro — o Google manda quanto esperar, e nada
 *      que a gente invente é melhor que o número que ele mandou;
 *   2. cota DIÁRIA (`PerDay`/RPD): a documentação diz que ela reseta à
 *      MEIA-NOITE DO PACÍFICO. Esperar até lá é o certo — tentar de minuto em
 *      minuto por horas seria pedir 429 centenas de vezes para saber o que o
 *      calendário já dizia;
 *   3. o resto (por minuto): um minuto.
 *
 * ========== O QUE ISTO NÃO RESOLVE ==========
 *
 * Os limites do Gemini são por PROJETO, não por chave. Duas chaves do mesmo
 * projeto compartilham a mesma cota, e aí não existe fallback nenhum — a paga
 * precisa vir de um projeto com faturamento próprio. Isso é configuração, não
 * código, e o código não tem como conferir: só o 429 da paga denunciaria.
 */

export type KeyTier = 'FREE' | 'PAID';

export interface SelectedKey {
  tier: KeyTier;
  apiKey: string;
}

/** Um minuto: o teto por MINUTO se resolve sozinho rápido. */
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Margem depois da meia-noite do Pacífico.
 *
 * Acertar o segundo exato do reset devolveria 429 de novo e adiaria a volta por
 * um dia inteiro no pior caso. Um minuto de folga custa um minuto.
 */
const RESET_MARGIN_MS = 60_000;

export class GeminiKeyRing {
  private freeBlockedUntil = 0;
  /** Por que ela está fora — vai para o log, para a espera ser explicável. */
  private freeReason = '';
  /**
   * O admin pediu PAGA — não a cota que esgotou, uma ESCOLHA.
   *
   * Vive separado de `freeBlockedUntil` de propósito: aquele é um FATO com prazo
   * (a cota volta na meia-noite do Pacífico, ou no minuto seguinte); isto é uma
   * preferência sem prazo nenhum, que só volta quando o próprio admin desligar.
   * Misturar os dois faria a tela mostrar "cota volta às HH:MM" para uma escolha
   * que não tem hora de voltar nenhuma.
   */
  private forcedPaid = false;

  constructor(
    private readonly freeKey: string,
    /** Ausente = o sistema roda exatamente como rodava, só com a gratuita. */
    private readonly paidKey: string | null,
    private readonly deps: {
      now?: () => Date;
      onSwitch?: (notice: { tier: KeyTier; until: Date | null; reason: string }) => void;
    } = {},
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * A chave desta tentativa.
   *
   * Sem chave paga, a gratuita é devolvida mesmo bloqueada: tentar e receber o
   * erro do provider é melhor que recusar em casa uma chamada que talvez
   * passasse — a cota pode ter voltado antes do previsto.
   */
  select(): SelectedKey {
    if (!this.paidKey) return { tier: 'FREE', apiKey: this.freeKey };

    // A ESCOLHA do admin ganha de tudo — inclusive de a gratuita estar de pé.
    // Sem chave paga não há o que forçar: cai no comportamento de sempre.
    if (this.forcedPaid) return { tier: 'PAID', apiKey: this.paidKey };

    if (this.now().getTime() >= this.freeBlockedUntil) {
      return { tier: 'FREE', apiKey: this.freeKey };
    }

    return { tier: 'PAID', apiKey: this.paidKey };
  }

  /**
   * Liga/desliga a ESCOLHA manual — não confunde com a cota ter esgotado.
   *
   * Só produz efeito de verdade com chave paga cadastrada: forçar sem ela não
   * teria para onde forçar, e `select()` já trata isso sozinho. Mesmo assim o
   * pedido é aceito e refletido no status — a UI que decide se avisa que não
   * há chave paga para a escolha valer.
   */
  setForcedPaid(value: boolean): void {
    if (this.forcedPaid === value) return;
    this.forcedPaid = value;
    // O tier resultante depois de mudar a escolha — desligar a força não
    // significa necessariamente "voltou para a gratuita": ela pode seguir
    // bloqueada por cota de verdade, e o aviso tem que dizer a que realmente
    // vale, não o que a intenção supunha.
    const resultado = this.select();
    this.deps.onSwitch?.({
      tier: resultado.tier,
      until: resultado.tier === 'PAID' && this.freeBlockedUntil > this.now().getTime()
        ? new Date(this.freeBlockedUntil)
        : null,
      reason: value ? 'admin forçou a chave paga' : 'admin voltou para automático',
    });
  }

  /**
   * A chamada voltou 429/RESOURCE_EXHAUSTED. Quem estava servindo sai de cena.
   *
   * Só a gratuita é marcada: a paga esgotada é outro problema — é teto de tier
   * ou de gasto —, e tirá-la de circulação deixaria o sistema sem nenhuma.
   */
  reportExhausted(tier: KeyTier, error: unknown): void {
    if (tier !== 'FREE' || !this.paidKey) return;

    const agora = this.now();
    const espera = cooldownFor(error, agora);
    const ate = new Date(agora.getTime() + espera);

    // Nunca encurta: dois pedidos em voo devolvem 429 quase juntos, e o segundo
    // (com `retryDelay` menor) adiantaria a volta para antes do reset real.
    if (ate.getTime() <= this.freeBlockedUntil) return;

    this.freeBlockedUntil = ate.getTime();
    this.freeReason = motivo(error);
    this.deps.onSwitch?.({ tier: 'PAID', until: ate, reason: this.freeReason });
  }

  /**
   * A gratuita respondeu: está de pé de novo.
   *
   * Chamado no sucesso, e é o outro lado da meia-abertura — sem isto, um
   * prazo estimado longo demais manteria a paga em uso depois de a cota já ter
   * voltado.
   */
  reportSuccess(tier: KeyTier): void {
    if (tier !== 'FREE' || this.freeBlockedUntil === 0) return;
    this.freeBlockedUntil = 0;
    this.freeReason = '';
    this.deps.onSwitch?.({ tier: 'FREE', until: null, reason: 'cota gratuita respondeu de novo' });
  }

  /** Para o log de boot, para diagnóstico e para a tela mostrar a Switch certa. */
  status(): {
    tier: KeyTier;
    freeAvailableAt: Date | null;
    reason: string;
    hasPaidKey: boolean;
    forcedPaid: boolean;
  } {
    const bloqueada = this.freeBlockedUntil > this.now().getTime();
    return {
      tier: this.select().tier,
      freeAvailableAt: bloqueada ? new Date(this.freeBlockedUntil) : null,
      reason: this.freeReason,
      hasPaidKey: this.paidKey !== null,
      forcedPaid: this.forcedPaid,
    };
  }
}

/** Quanto tempo a chave gratuita fica fora, a partir do erro que ela devolveu. */
export function cooldownFor(error: unknown, now: Date): number {
  const texto = error instanceof Error ? error.message : String(error);

  // 1. O provider disse quanto esperar. É a melhor fonte que existe.
  const declarado = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(texto);
  if (declarado?.[1]) {
    return Math.max(Number(declarado[1]) * 1000, 1_000);
  }

  // 2. Cota do DIA: só volta na virada do dia do Pacífico.
  if (/per\s*day|PerDay|\bRPD\b|requests? per day/i.test(texto)) {
    return msUntilPacificMidnight(now) + RESET_MARGIN_MS;
  }

  return DEFAULT_COOLDOWN_MS;
}

/**
 * Quanto falta para a meia-noite em Los Angeles.
 *
 * Pelo `Intl`, e não por uma conta de fuso: o Pacífico tem horário de verão, e
 * "UTC-8" está errado metade do ano. Perguntar a hora de PAREDE de lá e subtrair
 * do dia acerta nos dois períodos sem tabela nenhuma.
 */
export function msUntilPacificMidnight(now: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const valor = (tipo: string): number =>
    Number(partes.find((parte) => parte.type === tipo)?.value ?? '0');

  // `hour12: false` devolve 24 na meia-noite em alguns runtimes.
  const decorrido = ((valor('hour') % 24) * 3600 + valor('minute') * 60 + valor('second')) * 1000;

  return 24 * 60 * 60 * 1000 - decorrido;
}

/** O erro em uma linha, para o log dizer por que a chave saiu de cena. */
function motivo(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  return texto.replace(/\s+/g, ' ').slice(0, 200);
}
