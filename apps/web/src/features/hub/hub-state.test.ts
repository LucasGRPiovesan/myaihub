import { describe, expect, it } from 'vitest';
import { hubReducer, initialHubState, type HubState, type OperationStep } from './hub-state';

const STEPS: OperationStep[] = [
  { id: 'load', label: 'Carregando projeto', status: 'pending' },
  { id: 'analyze', label: 'Analisando campanha', status: 'pending' },
];

function started(state: HubState = initialHubState, seq = 1): HubState {
  return hubReducer(state, {
    type: 'operation.started',
    seq,
    operation: 'campaign_analysis',
    label: 'Analisando campanha',
    steps: STEPS,
  });
}

describe('hubReducer', () => {
  it('abre o painel quando uma operação começa', () => {
    const state = started();
    expect(state.open).toBe(true);
    expect(state.status).toBe('running');
    expect(state.steps).toHaveLength(2);
  });

  it('acumula o texto em streaming', () => {
    let state = started();
    state = hubReducer(state, { type: 'message.delta', seq: 2, text: 'Entendi ' });
    state = hubReducer(state, { type: 'message.delta', seq: 3, text: 'o objetivo.' });
    expect(state.streamedText).toBe('Entendi o objetivo.');
  });

  it('atualiza apenas o passo indicado', () => {
    let state = started();
    state = hubReducer(state, {
      type: 'operation.progress',
      seq: 2,
      stepId: 'load',
      status: 'done',
    });

    expect(state.steps[0]?.status).toBe('done');
    expect(state.steps[1]?.status).toBe('pending');
  });

  it('descarta eventos duplicados ou fora de ordem', () => {
    let state = started();
    state = hubReducer(state, { type: 'message.delta', seq: 5, text: 'A' });

    // Chega atrasado (SSE reconectado com replay) — não pode duplicar o texto.
    const replayed = hubReducer(state, { type: 'message.delta', seq: 5, text: 'A' });
    const outOfOrder = hubReducer(state, { type: 'message.delta', seq: 3, text: 'B' });

    expect(replayed.streamedText).toBe('A');
    expect(outOfOrder.streamedText).toBe('A');
  });

  it('não deixa passo pendurado em running ao concluir', () => {
    let state = started();
    state = hubReducer(state, {
      type: 'operation.progress',
      seq: 2,
      stepId: 'analyze',
      status: 'running',
    });
    state = hubReducer(state, { type: 'operation.completed', seq: 3, status: 'completed' });

    expect(state.status).toBe('completed');
    expect(state.steps.every((step) => step.status === 'done')).toBe(true);
  });

  it('marca todos os passos abertos como falhos quando a operação falha', () => {
    let state = started();
    state = hubReducer(state, { type: 'operation.completed', seq: 2, status: 'failed' });

    expect(state.steps.every((step) => step.status === 'failed')).toBe(true);
  });

  it('preserva passos já concluídos quando a operação falha depois', () => {
    let state = started();
    state = hubReducer(state, {
      type: 'operation.progress',
      seq: 2,
      stepId: 'load',
      status: 'done',
    });
    state = hubReducer(state, { type: 'operation.completed', seq: 3, status: 'failed' });

    expect(state.steps[0]?.status).toBe('done');
    expect(state.steps[1]?.status).toBe('failed');
  });

  it('fechar o painel não cancela a operação em andamento', () => {
    let state = started();
    state = hubReducer(state, { type: 'panel.close' });

    expect(state.open).toBe(false);
    expect(state.status).toBe('running');
    expect(state.operation).toBe('campaign_analysis');
  });

  it('um novo pedido arquiva o turno anterior em vez de apagá-lo', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'Crie o Philips' });
    state = started(state, 1);
    state = hubReducer(state, { type: 'message.delta', seq: 2, text: 'Criei o Philips.' });
    state = hubReducer(state, { type: 'operation.completed', seq: 3, status: 'completed' });

    state = hubReducer(state, { type: 'request.sent', content: 'Agora deixe ele objetivo' });

    // O painel é uma conversa: a resposta anterior continua visível.
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.request).toBe('Crie o Philips');
    expect(state.turns[0]?.answer).toBe('Criei o Philips.');
    expect(state.turns[0]?.status).toBe('completed');

    // E o turno novo começa limpo.
    expect(state.streamedText).toBe('');
    expect(state.request).toBe('Agora deixe ele objetivo');
    expect(state.lastSeq).toBe(0);
  });

  it('separa aviso informativo de erro — vermelho só para o que exige reação', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'x' });
    state = started(state, 1);
    state = hubReducer(state, {
      type: 'notice',
      seq: 2,
      code: 'VALUE_ADJUSTED',
      message: 'Corrigi a chave.',
    });
    state = hubReducer(state, {
      type: 'notice',
      seq: 3,
      code: 'CONFLICT_DETECTED',
      message: 'Isto contradiz o item CM01.',
    });

    expect(state.notices[0]?.tone).toBe('info');
    expect(state.notices[1]?.tone).toBe('warning');
  });

  it('a falha carrega o motivo junto do evento de conclusão', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'x' });
    state = started(state, 1);
    state = hubReducer(state, {
      type: 'operation.completed',
      seq: 2,
      status: 'failed',
      errorCode: 'MUTATION_OUT_OF_SCOPE',
      errorMessage: 'Nenhuma alteração pôde ser aplicada.',
    });

    expect(state.status).toBe('failed');
    expect(state.notices.at(-1)).toMatchObject({
      tone: 'danger',
      message: 'Nenhuma alteração pôde ser aplicada.',
    });
  });

  it('registra a entidade tocada para o painel oferecer o caminho até ela', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'x' });
    state = started(state, 1);
    state = hubReducer(state, {
      type: 'entity',
      seq: 2,
      id: '01AGENT',
      name: 'Philips',
      target: 'AGENT',
    });

    expect(state.entity).toEqual({
      id: '01AGENT',
      name: 'Philips',
      target: 'AGENT',
      touched: [],
    });
  });

  it('guarda as REGRAS tocadas, para o painel levar direto a elas', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'x' });
    state = started(state, 1);
    state = hubReducer(state, {
      type: 'entity',
      seq: 2,
      id: '01AGENT',
      name: 'Philips',
      target: 'AGENT',
      touched: [{ facet: 'strategies', code: 'ST01', label: 'Diagnostica antes' }],
    });

    // "Ajustei a ST01" sem o caminho até a ST01 obriga o usuário a caçá-la em
    // sete facetas para conferir o que foi escrito no lugar dele.
    expect(state.entity?.touched).toEqual([
      { facet: 'strategies', code: 'ST01', label: 'Diagnostica antes' },
    ]);
  });

  it('guarda as lacunas que o OS preferiu perguntar a inventar', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'x' });
    state = started(state, 1);
    state = hubReducer(state, {
      type: 'gaps',
      seq: 2,
      questions: ['Qual a região de atuação?'],
    });

    expect(state.questions).toEqual(['Qual a região de atuação?']);
  });

  /**
   * O histórico é ÚNICO e contínuo; o contexto AGRUPA.
   *
   * Antes, trocar de escopo zerava o transcrito: o usuário perdia a resposta
   * que acabara de ler só por ter ido conferir o que o OS mudou — e conferir é
   * justamente o que o painel pede que ele faça.
   */
  it('trocar de contexto PRESERVA o histórico e carimba de onde cada turno é', () => {
    let state = hubReducer(initialHubState, {
      type: 'scope.changed',
      scopeKey: 'ROOT:',
      scopeLabel: 'Seu hub',
    });
    state = hubReducer(state, { type: 'request.sent', content: 'Crie o projeto Sankar' });
    state = started(state, 1);
    state = hubReducer(state, { type: 'message.delta', seq: 2, text: 'Criei o Sankar.' });
    state = hubReducer(state, { type: 'operation.completed', seq: 3, status: 'completed' });

    state = hubReducer(state, {
      type: 'scope.changed',
      scopeKey: 'AGENT:01AGT',
      scopeLabel: 'Alex',
    });

    // O turno continua no transcrito, carimbado com o contexto em que foi
    // pedido — não com o que o usuário abriu depois.
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.context).toEqual({ key: 'ROOT:', label: 'Seu hub' });
    expect(state.turns[0]?.answer).toBe('Criei o Sankar.');

    // A VISTA do turno em curso fecha: acompanhar em tempo real algo de outra
    // tela seria pior que fechar.
    expect(state.streamedText).toBe('');
    expect(state.status).toBe('idle');
    expect(state.scopeKey).toBe('AGENT:01AGT');
    expect(state.scopeLabel).toBe('Alex');
  });

  it('o log do processo se acumula e vai junto para o transcrito', () => {
    let state = hubReducer(initialHubState, {
      type: 'scope.changed',
      scopeKey: 'AGENT:01AGT',
      scopeLabel: 'Alex',
    });
    state = hubReducer(state, { type: 'request.sent', content: 'seja mais objetivo' });
    state = started(state, 1);
    state = hubReducer(state, {
      type: 'operation.trace',
      seq: 2,
      text: 'Contexto montado: 7 blocos.',
      at: '2026-09-04T10:00:00.000Z',
    });
    state = hubReducer(state, {
      type: 'operation.trace',
      seq: 3,
      text: 'Consultando o modelo (hub.reasoning).',
      at: '2026-09-04T10:00:01.000Z',
    });

    expect(state.trace).toHaveLength(2);

    state = hubReducer(state, { type: 'operation.completed', seq: 4, status: 'completed' });
    state = hubReducer(state, { type: 'request.sent', content: 'e mais direto' });

    // O log pertence ao TURNO: quem rola para trás precisa poder entender por
    // que aquele turno custou o que custou.
    expect(state.turns[0]?.trace).toHaveLength(2);
    expect(state.trace).toHaveLength(0);
  });

  it('evento de log fora de ordem é descartado, como os outros', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'oi' });
    state = started(state, 5);
    state = hubReducer(state, {
      type: 'operation.trace',
      seq: 2,
      text: 'linha atrasada',
      at: '2026-09-04T10:00:00.000Z',
    });

    expect(state.trace).toHaveLength(0);
  });

  it('o painel aberto continua aberto ao trocar de contexto', () => {
    let state = hubReducer(initialHubState, { type: 'panel.open' });
    state = hubReducer(state, {
      type: 'scope.changed',
      scopeKey: 'PROJECT:01PRJ',
      scopeLabel: 'PROJECT:01PRJ',
    });

    // Fechar sozinho seria o painel sumindo no meio da navegação.
    expect(state.open).toBe(true);
  });

  it('o mesmo escopo não reinicia o painel a cada render', () => {
    let state = hubReducer(initialHubState, {
      type: 'scope.changed',
      scopeKey: 'PROJECT:01PRJ',
      scopeLabel: 'PROJECT:01PRJ',
    });
    state = hubReducer(state, { type: 'request.sent', content: 'oi' });
    const before = state;

    // O efeito da rota dispara em todo render; sem esta guarda, o painel
    // apagaria a operação em andamento a cada mudança de estado.
    expect(
      hubReducer(state, {
        type: 'scope.changed',
        scopeKey: 'PROJECT:01PRJ',
        scopeLabel: 'PROJECT:01PRJ',
      }),
    ).toBe(before);
  });

  it('uma falha antes de existir operação ainda aparece no painel', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'x' });
    state = hubReducer(state, { type: 'request.failed', message: 'API fora do ar.' });

    // Sem isto, um erro de rede deixaria o painel girando para sempre.
    expect(state.status).toBe('failed');
    expect(state.notices.at(-1)?.tone).toBe('danger');
  });
});

describe('o painel também conversa', () => {
  function ask() {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'ele já se adapta?' });
    state = hubReducer(state, {
      type: 'operation.started',
      seq: 1,
      operation: 'agent.configure',
      label: 'Ajustando o agente',
      steps: STEPS,
    });
    return hubReducer(state, { type: 'operation.answering', seq: 2 });
  }

  it('turno de resposta não exibe checklist de trabalho', () => {
    const state = ask();

    expect(state.answering).toBe(true);
    // Passos que não vão acontecer não podem ficar na tela: o usuário leria
    // "Analisando / Salvando" como prova de que algo foi alterado.
    expect(state.steps).toEqual([]);
  });

  it('plano que chegue depois não ressuscita o checklist', () => {
    const state = hubReducer(ask(), {
      type: 'operation.plan',
      seq: 3,
      steps: [{ id: 'plan-0', label: 'Aplicando', status: 'running' }],
    });

    expect(state.steps).toEqual([]);
  });

  it('o transcrito lembra que aquele turno foi resposta', () => {
    let state = hubReducer(ask(), { type: 'message.delta', seq: 3, text: 'Hoje não.' });
    state = hubReducer(state, { type: 'operation.completed', seq: 4, status: 'completed' });
    state = hubReducer(state, { type: 'request.sent', content: 'então ajusta' });

    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.answering).toBe(true);
    expect(state.turns[0]?.answer).toBe('Hoje não.');
  });

  it('turno de alteração continua mostrando o checklist', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'seja objetivo' });
    state = hubReducer(state, {
      type: 'operation.started',
      seq: 1,
      operation: 'agent.configure',
      label: 'Ajustando o agente',
      steps: STEPS,
    });

    expect(state.answering).toBe(false);
    expect(state.steps).toHaveLength(STEPS.length);
  });
});

describe('turno do painel — o que o usuário vê', () => {
  it('a leitura do pedido não vira aviso: tem lugar próprio no turno', () => {
    let state = hubReducer(initialHubState, { type: 'request.sent', content: 'ajusta a saudação' });
    state = started(state);
    state = hubReducer(state, {
      type: 'notice',
      seq: 2,
      code: 'OPERATION_ROUTED',
      message: 'Cortesia é da base do agente.',
    });

    expect(state.understood).toBe('Cortesia é da base do agente.');
    expect(state.notices).toHaveLength(0);
  });

  it('a imagem colada fica no turno depois de arquivado', () => {
    const imagem = { id: '01IMG', url: '/api/media/01IMG', fileName: 'print.png' };
    let state = hubReducer(initialHubState, {
      type: 'request.sent',
      content: 'olha isso',
      attachments: [imagem],
    });
    state = started(state);
    state = hubReducer(state, { type: 'operation.completed', seq: 2, status: 'completed' });
    state = hubReducer(state, { type: 'request.sent', content: 'e agora?' });

    expect(state.turns.at(-1)?.attachments).toEqual([imagem]);
    // O turno novo começa sem a imagem do anterior.
    expect(state.attachments).toEqual([]);
  });
});
