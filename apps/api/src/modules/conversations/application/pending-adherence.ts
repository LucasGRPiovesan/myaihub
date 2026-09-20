import type { RuleViolation } from '../../myaihub/domain/rule-checks.js';

/**
 * O VEREDITO QUE CHEGA DEPOIS DA RESPOSTA.
 *
 * O auditor rodava SERIALIZADO na frente do usuário: o agente respondia, e a
 * fala só aparecia na tela depois de uma segunda chamada ao provider conferir
 * as regras. Medido no banco, emparelhando cada turno com a auditoria seguinte:
 * a mediana do agente era ~1s e a do auditor ~1,1s — ele DOBRAVA a espera. E
 * quando travava, cobrava 8s a mais para no fim dizer "checagem indisponível".
 *
 * A arquitetura já dizia metade disto: "falha do validador NÃO derruba o
 * turno — a resposta já foi produzida e já foi paga". Esperar por ele é o mesmo
 * erro, só que silencioso: o texto existe, está pago, e fica retido por um dado
 * ACESSÓRIO sobre ele.
 *
 * Então o turno volta assim que o agente responde, e o veredito é buscado
 * depois. Este mapa é onde ele espera.
 *
 * ========== POR QUE EM MEMÓRIA ==========
 *
 * As violações continuam sendo GRAVADAS — elas são o dado. O que vive aqui é só
 * o ESTADO da conferência (rodando, concluída, indisponível), que é interface:
 * existe para o selo da tela e morre com ele. Persistir isso pediria uma coluna
 * nova para um dado que não sobrevive a nada nem é lido por ninguém depois.
 *
 * Reiniciar o processo perde vereditos em voo. O custo é o selo daquele turno
 * dizer "indisponível" — que é a verdade — em vez de mentir dizendo "cumpridas".
 */

export type AdherenceStatus = 'CHECKING' | 'CHECKED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface AdherenceVerdict {
  status: AdherenceStatus;
  violations: RuleViolation[];
}

/**
 * Quanto tempo um veredito fica disponível para ser buscado.
 *
 * Generoso o bastante para a aba que ficou em segundo plano e volta, curto o
 * bastante para o mapa não virar um vazamento de memória num servidor que roda
 * por semanas.
 */
const TTL_MS = 10 * 60 * 1000;

export class PendingAdherence {
  private readonly entries = new Map<string, { verdict: AdherenceVerdict; at: number }>();

  /** Marca que a conferência daquele turno começou. */
  start(turnId: string): void {
    this.set(turnId, { status: 'CHECKING', violations: [] });
  }

  set(turnId: string, verdict: AdherenceVerdict): void {
    this.sweep();
    this.entries.set(turnId, { verdict, at: Date.now() });
  }

  /**
   * O veredito, ou `null` quando não há nada sobre este turno.
   *
   * `null` NÃO é "sem violação": é "não sei". Quem chama precisa distinguir os
   * dois — confundir foi o que já pintou o selo verde enquanto o validador
   * morria, e é justamente a mentira que este campo existe para impedir.
   */
  get(turnId: string): AdherenceVerdict | null {
    const found = this.entries.get(turnId);
    if (!found) return null;
    if (Date.now() - found.at > TTL_MS) {
      this.entries.delete(turnId);
      return null;
    }
    return found.verdict;
  }

  private sweep(): void {
    const limite = Date.now() - TTL_MS;
    for (const [key, value] of this.entries) {
      if (value.at < limite) this.entries.delete(key);
    }
  }
}
