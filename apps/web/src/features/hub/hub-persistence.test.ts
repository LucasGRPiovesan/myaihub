import { beforeEach, describe, expect, it } from 'vitest';
import { forgetHubHistory, readHubHistory, writeHubHistory } from './hub-persistence';
import type { HubTurn } from './hub-state';

/**
 * O transcrito sobrevive à sessão de login — e a nada menos que isso.
 *
 * Quem apagava era uma INFERÊNCIA: "havia usuário, agora não há, logo saiu".
 * Qualquer piscada da sessão passava por logout, e a reação era varrer o
 * histórico de todos os usuários. Foi assim que duplicar uma aba zerou a
 * conversa do painel.
 */
function turno(id: string): HubTurn {
  return {
    id,
    context: { key: 'ROOT:', label: 'MyAIHub' },
    request: 'quero um projeto',
    operationLabel: 'Criando projeto',
    steps: [],
    answer: 'feito',
    answering: false,
    notices: [],
    questions: [],
    status: 'completed',
    entity: null,
    costMicros: 0,
    totalTokens: 0,
    trace: [],
  };
}

describe('transcrito do painel', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('volta inteiro para o mesmo usuário', () => {
    writeHubHistory('01USUARIO', [turno('a'), turno('b')]);

    expect(readHubHistory('01USUARIO').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('não vaza entre usuários — a chave carrega quem é', () => {
    writeHubHistory('01USUARIO', [turno('a')]);

    expect(readHubHistory('01OUTRO')).toEqual([]);
  });

  it('apagar um usuário não apaga o outro', () => {
    // O logout de quem saiu não pode levar junto a conversa de quem ficou —
    // e a varredura sem `userId` fazia exatamente isso.
    writeHubHistory('01USUARIO', [turno('a')]);
    writeHubHistory('01OUTRO', [turno('b')]);

    forgetHubHistory('01USUARIO');

    expect(readHubHistory('01USUARIO')).toEqual([]);
    expect(readHubHistory('01OUTRO').map((item) => item.id)).toEqual(['b']);
  });

  it('sem userId, o logout varre tudo — é o caso da sessão já expirada', () => {
    writeHubHistory('01USUARIO', [turno('a')]);
    writeHubHistory('01OUTRO', [turno('b')]);

    forgetHubHistory();

    expect(readHubHistory('01USUARIO')).toEqual([]);
    expect(readHubHistory('01OUTRO')).toEqual([]);
  });

  it('descarta turno malformado em vez de derrubar o painel', () => {
    // O que está gravado pode ter vindo de uma versão anterior da tela.
    sessionStorage.setItem(
      'myaihub.hub.history.01USUARIO',
      JSON.stringify([turno('a'), { id: 'b' }, null, 'lixo']),
    );

    expect(readHubHistory('01USUARIO').map((item) => item.id)).toEqual(['a']);
  });

  it('JSON corrompido devolve vazio, sem lançar', () => {
    sessionStorage.setItem('myaihub.hub.history.01USUARIO', '{isso não é json');

    expect(() => readHubHistory('01USUARIO')).not.toThrow();
    expect(readHubHistory('01USUARIO')).toEqual([]);
  });
});
