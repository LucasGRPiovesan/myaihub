import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTIONS } from '../domain/system-action.js';
import { SystemActionExecutor, sliceFromMarker } from './system-action-executor.js';

describe('SystemActionExecutor', () => {
  it('toda ação do catálogo tem quem a execute', () => {
    // Ação no catálogo sem handler seria oferecida ao roteador e falharia só
    // quando alguém pedisse — o pior momento de descobrir.
    const executor = new SystemActionExecutor({} as never);
    for (const action of SYSTEM_ACTIONS) {
      expect(executor.handles(action.name), action.name).toBe(true);
    }
  });
});

describe('sliceFromMarker', () => {
  it('recorta a mensagem a partir das primeiras palavras do texto, byte a byte', () => {
    const texto = 'Horário: 8h às 18h.\nSábado fechado.';
    expect(sliceFromMarker(`guarda no Sankar: ${texto}`, 'Horário: 8h às')).toBe(texto);
  });

  it('marcador que não bate guarda a mensagem inteira — nunca uma paráfrase', () => {
    expect(sliceFromMarker('texto do usuário', 'algo que não está lá')).toBe('texto do usuário');
  });
});
