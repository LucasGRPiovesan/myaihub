import { beforeEach, describe, expect, it } from 'vitest';
import { isSoundEnabled, playOutcome, setSoundEnabled } from './sound';

/**
 * O aviso sonoro é ACESSÓRIO, e o teste existe para provar isso.
 *
 * O jsdom não implementa Web Audio: aqui `playOutcome` roda exatamente no
 * cenário de um navegador sem áudio, e não pode lançar. Se lançasse, a exceção
 * subiria pelo handler de `operation.completed` e derrubaria o painel no fim de
 * toda operação — o pior momento possível, porque é quando o resultado chega.
 */
describe('aviso sonoro do painel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('nasce ligado — o usuário pediu o aviso, não a opção de ativá-lo', () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it('a escolha de silenciar sobrevive ao recarregamento', () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);

    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it('sem Web Audio, não lança — nem no acerto nem na falha', () => {
    expect(() => playOutcome('completed')).not.toThrow();
    expect(() => playOutcome('failed')).not.toThrow();
    expect(() => playOutcome('completed', { force: true })).not.toThrow();
  });

  it('silenciado, nem chega a tocar', () => {
    setSoundEnabled(false);
    expect(() => playOutcome('completed')).not.toThrow();
  });

  /*
    O som é para quem SAIU. Com o painel na frente ele não informa nada que a
    tela já não diga, e um aviso que não informa é o que ensina a desligar o som.

    O jsdom não implementa Web Audio, então aqui não dá para provar que TOCOU —
    o que dá para provar, e é o que interessa, é a decisão de tocar. `criaria`
    espia a única evidência observável dela: a tentativa de construir o contexto.
  */
  function criaria(chamada: () => void): boolean {
    let tentou = false;
    const original = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: function FakeAudioContext() {
        tentou = true;
        throw new Error('sem áudio no jsdom');
      },
    });

    try {
      chamada();
    } finally {
      if (original) Object.defineProperty(window, 'AudioContext', original);
      else delete (window as { AudioContext?: unknown }).AudioContext;
    }

    return tentou;
  }

  /**
   * Olhando = aba visível E janela em foco.
   *
   * O jsdom nasce SEM foco (a janela de teste não é a do sistema), então o
   * default dele é justamente o caso "longe" — declarar o foco aqui é o que
   * reproduz o usuário com o painel na frente.
   */
  function olhando<T>(executa: () => T): T {
    const original = document.hasFocus;
    document.hasFocus = () => true;
    try {
      return executa();
    } finally {
      document.hasFocus = original;
    }
  }

  it('com o usuário olhando, não toca', () => {
    expect(olhando(() => criaria(() => playOutcome('completed')))).toBe(false);
  });

  it('janela atrás de outra — visível e sem foco — conta como longe', () => {
    // O caso do segundo monitor e o das janelas lado a lado: `visibilityState`
    // não pega nenhum dos dois, e é exatamente onde o aviso serve.
    expect(criaria(() => playOutcome('completed'))).toBe(true);
  });

  it('com a aba escondida, toca', () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    try {
      expect(criaria(() => playOutcome('completed'))).toBe(true);
    } finally {
      if (original) Object.defineProperty(Document.prototype, 'visibilityState', original);
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it('`force` ignora a regra — é o clique do botão de ligar o som', () => {
    expect(olhando(() => criaria(() => playOutcome('completed', { force: true })))).toBe(true);
  });
});
