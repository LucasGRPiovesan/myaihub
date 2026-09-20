import { describe, expect, it } from 'vitest';
import { ServedTierObserver } from './served-tier.js';

/**
 * O fato vence a previsão — e antes de existir fato, não há afirmação.
 *
 * O adapter só sabe qual chave TENTARIA agora, e essa suposição reinicia com o
 * processo. Foi ela que travou o seletor de modelo como se ainda houvesse cota
 * gratuita, com as chamadas saindo pela paga.
 */
describe('cota observada', () => {
  it('não afirma nada antes da primeira chamada', () => {
    expect(new ServedTierObserver().last()).toBeNull();
  });

  it('guarda a cota da última chamada observada', () => {
    const observador = new ServedTierObserver();
    observador.record('FREE');
    observador.record('PAID');

    expect(observador.last()).toBe('PAID');
  });

  it('chamada sem cota declarada não apaga o que já se sabia', () => {
    // É o caso do FakeProvider: ele não distingue cotas, e uma chamada dele
    // no meio não pode fazer o sistema esquecer que a gratuita acabou.
    const observador = new ServedTierObserver();
    observador.record('PAID');
    observador.record(undefined);

    expect(observador.last()).toBe('PAID');
  });
});
