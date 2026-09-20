import type { Logger } from '../../../shared/application/ports.js';
import type { ExchangeRate, ExchangeRateProvider } from '../domain/exchange-rate.js';

/**
 * A cotação vem do PTAX do Banco Central — e vem de lá por um motivo.
 *
 * PTAX é a taxa OFICIAL brasileira: é a referência que contabilidade, contrato
 * e fisco usam, é pública, não pede chave e não tem cota. Um agregador de
 * cotação de mercado daria um número que ninguém consegue conferir depois e que
 * muda a cada minuto; o que o usuário precisa saber é quanto ele gastou, não a
 * variação intradiária do câmbio.
 *
 * O padrão de acesso é o recomendado para dado que muda uma vez por dia:
 * busca uma vez, guarda em memória, serve SEMPRE do cache e atualiza por trás
 * quando envelhece (stale-while-revalidate). Nenhuma tela espera pela rede, e
 * a fonte recebe ~2 requisições por dia em vez de uma por clique.
 *
 * O PTAX é publicado em dia ÚTIL, por volta das 13h. Em fim de semana, feriado
 * e no começo da manhã a consulta do dia volta vazia — por isso a busca anda
 * para trás até achar o último dia com boletim fechado.
 */

/** Quanto tempo o valor em memória vale antes de valer a pena buscar de novo. */
const TTL_MS = 6 * 60 * 60 * 1000;

/** Quantos dias andar para trás procurando o último boletim publicado. */
const MAX_DAYS_BACK = 8;

/**
 * O valor que sobra quando NUNCA houve resposta da fonte.
 *
 * Existe para o primeiro boot sem rede não deixar a tela sem número nenhum.
 * Vem marcado como `stale`, então a tela diz que é aproximado — mentir sobre a
 * precisão de um valor de dinheiro seria pior que mostrar um traço.
 */
const FALLBACK: ExchangeRate = {
  brlPerUsd: 5.4,
  quotedAt: '1970-01-01',
  source: 'valor de referência (a cotação ainda não foi obtida)',
  stale: true,
};

interface PtaxResponse {
  value?: Array<{ cotacaoVenda?: number; dataHoraCotacao?: string }>;
}

export class PtaxExchangeRateProvider implements ExchangeRateProvider {
  private cache: ExchangeRate = FALLBACK;
  private fetchedAt = 0;
  /** A busca em voo, para dois pedidos simultâneos não virarem duas buscas. */
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: { logger: Logger; now?: () => Date }) {}

  current(): ExchangeRate {
    if (Date.now() - this.fetchedAt > TTL_MS) void this.refresh();
    return this.cache;
  }

  /**
   * Aquece o cache no boot.
   *
   * Sem isto, o PRIMEIRO usuário do dia veria o valor de referência por alguns
   * segundos — e "aproximado" logo depois de subir é a hora mais fácil de
   * evitar. Falha aqui não derruba o boot: cotação é informação de tela.
   */
  async warm(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetch()
      .then((rate) => {
        if (rate) {
          this.cache = rate;
          this.fetchedAt = Date.now();
          return;
        }
        // Não achou boletim: mantém o que havia e marca como velho, para a
        // tela poder dizer isso em vez de exibir um número com cara de novo.
        this.cache = { ...this.cache, stale: true };
      })
      .catch((error: unknown) => {
        this.deps.logger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'não foi possível atualizar a cotação do dólar; seguindo com a anterior',
        );
        this.cache = { ...this.cache, stale: true };
      })
      .finally(() => {
        this.inFlight = null;
        // Mesmo falhando, marca a tentativa: sem isso, uma fonte fora do ar
        // faria toda leitura de tela disparar uma busca nova.
        this.fetchedAt = Date.now();
      });

    return this.inFlight;
  }

  private async fetch(): Promise<ExchangeRate | null> {
    const hoje = this.deps.now?.() ?? new Date();

    for (let dias = 0; dias < MAX_DAYS_BACK; dias += 1) {
      const dia = new Date(hoje);
      dia.setDate(dia.getDate() - dias);

      const cotacao = await this.fetchDay(dia);
      if (cotacao) return cotacao;
    }

    return null;
  }

  private async fetchDay(dia: Date): Promise<ExchangeRate | null> {
    const mm = String(dia.getMonth() + 1).padStart(2, '0');
    const dd = String(dia.getDate()).padStart(2, '0');
    const url =
      'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
      `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${mm}-${dd}-${dia.getFullYear()}'` +
      '&$top=1&$format=json&$select=cotacaoVenda,dataHoraCotacao';

    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      // Teto curto: isto roda por trás, e uma fonte lenta não pode segurar um
      // recurso do processo por minutos esperando um número que já existe em
      // memória na versão de ontem.
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as PtaxResponse;
    const primeira = body.value?.[0];
    const venda = primeira?.cotacaoVenda;

    // A venda é a ponta certa: é o que se paga para COMPRAR dólar, que é o que
    // acontece quando a fatura do provider chega.
    if (typeof venda !== 'number' || !Number.isFinite(venda) || venda <= 0) return null;

    return {
      brlPerUsd: venda,
      quotedAt: primeira?.dataHoraCotacao ?? `${dia.getFullYear()}-${mm}-${dd}`,
      source: 'PTAX · Banco Central do Brasil',
      stale: false,
    };
  }
}
