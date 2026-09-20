import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * TODO pedido ao provider tem que ser NECESSÁRIO.
 *
 * Houve aqui uma corrida de pedidos: passados 4s de silêncio, um segundo partia
 * ao lado do primeiro — que continuava vivo — e ganhava quem falasse primeiro.
 * Cortava a cauda lenta pela metade e custava o que ninguém tinha autorizado:
 * um pedido disparado sem o anterior ter falhado, num sistema em que cada
 * pedido consome dinheiro e cota.
 *
 * A regra agora é: um pedido por vez; repetição só DEPOIS de uma falha; e,
 * falhando de novo, o erro vai para a tela com o botão de tentar de novo,
 * porque a decisão de gastar mais uma vez é do usuário.
 *
 * Este teste lê o próprio código porque o que se quer proibir é uma FORMA — e
 * ela é fácil de reintroduzir com boa intenção, para consertar latência.
 */
const fonte = readFileSync(new URL('./gemini-provider.ts', import.meta.url), 'utf8');

describe('um pedido por vez', () => {
  it('não existe corrida de pedidos no adapter', () => {
    expect(fonte).not.toContain('readRaced');
    expect(fonte).not.toContain('MAX_INFLIGHT');
    expect(fonte).not.toContain('hedgeAfterMs');
  });

  it('nenhum disparo em paralelo: sem Promise.any nem Promise.race', () => {
    // As duas são a assinatura de "mandei mais de um e fico com o primeiro".
    expect(fonte).not.toContain('Promise.any');
    expect(fonte).not.toContain('Promise.race');
  });

  it('a repetição continua existindo — e continua sendo sequencial', () => {
    // Repetir depois da falha é necessário: sem isso, um 503 do provider vira
    // trabalho perdido do usuário. O que não pode é repetir ANTES de falhar.
    expect(fonte).toContain('withTransientRetry');
    expect(fonte).toContain('await new Promise((resolve) => setTimeout(resolve, delay))');
  });
});
