/**
 * Estado do painel vivo do MyAIHub (§28, §32).
 *
 * O reducer é a tradução direta do Live UI Event Protocol: cada evento SSE vira
 * uma ação, e o painel é uma função do que o OS emitiu. Nada de estado paralelo
 * inferido na UI — se o painel mostra, é porque o servidor disse.
 */

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OperationStep {
  id: string;
  label: string;
  status: StepStatus;
}

/**
 * Aviso do OS durante a operação.
 *
 * `tone` separa o que o usuário PRECISA reagir do que ele só precisa saber: um
 * `VALUE_ADJUSTED` ("corrigi a chave") não é um erro, e pintá-lo de vermelho
 * ensina o usuário a ignorar vermelho.
 */
export interface HubNotice {
  id: string;
  code: string;
  message: string;
  tone: 'info' | 'warning' | 'danger';
}

/**
 * O CONTEXTO em que um turno aconteceu.
 *
 * O painel guarda um histórico só, contínuo, e é o contexto que organiza a
 * leitura: três perguntas sobre um agente, depois duas sobre um projeto. Sem
 * ele o transcrito vira uma lista plana em que a resposta sobre um agente
 * aparece logo abaixo de outra sobre um projeto, sem nada dizendo que mudou.
 */
export interface HubTurnContext {
  /** `AGENT:01ABC` — o mesmo `scopeKey` que a rota resolve. */
  key: string;
  /** O que mostrar no cabeçalho do grupo. */
  label: string;
}

/**
 * Imagem colada junto do pedido.
 *
 * O painel mostrava o texto do pedido e a imagem sumia no envio — o usuário
 * rolava para trás e não via mais o print sobre o qual tinha perguntado. Fica a
 * URL do `MediaAsset` (o `blob:` morre no F5), só enquanto a sessão durar.
 */
export interface HubAttachmentRef {
  id: string;
  url: string;
  fileName: string;
}

/** Uma linha do log do OS, com o instante em que aconteceu. */
export interface HubTraceLine {
  text: string;
  at: string;
}

/** Uma operação já concluída, preservada no transcrito do painel. */
export interface HubTurn {
  id: string;
  /** Onde o usuário estava quando pediu. É por aqui que a tela agrupa. */
  context: HubTurnContext;
  /** O que o usuário escreveu. */
  request: string;
  /** As imagens que foram junto. */
  attachments?: HubAttachmentRef[];
  /**
   * O que o S.O entendeu, quando a escolha dele diferiu da tela.
   *
   * Era um aviso laranja no meio da resposta — lido como problema, quando é a
   * frase mais útil do turno: ONDE ele decidiu aplicar.
   */
  understood?: string;
  operationLabel: string;
  steps: OperationStep[];
  answer: string;
  /**
   * O turno foi uma RESPOSTA, não uma alteração.
   *
   * Guardado no transcrito porque o usuário rola para trás: sem isto, uma
   * pergunta respondida ficaria com o rótulo "Ajustando o agente" e o checklist
   * de trabalho, exatamente a leitura errada.
   */
  answering: boolean;
  notices: HubNotice[];
  /** Perguntas que o OS registrou como lacunas em vez de inventar resposta. */
  questions: string[];
  status: 'completed' | 'failed';
  /** Entidade tocada, quando houve. A UI oferece um link para ela. */
  entity: {
    id: string;
    name: string;
    target: string;
    /** As regras que o turno criou ou alterou, para o usuário ir conferir. */
    touched?: Array<{ facet: string; code: string; label: string }>;
    /** O ofício que o turno também versionou, quando houve. */
    playbook?: { key: string; label: string; versionNumber: number };
  } | null;
  costMicros: number;
  totalTokens: number;
  /** O log do processo, guardado para quem rolar para trás entender o custo. */
  trace: HubTraceLine[];
}

export interface HubState {
  /** O painel só aparece quando há operação ativa ou conversa aberta (§30). */
  open: boolean;
  /**
   * Escopo a que este transcrito pertence (`PROJECT:01ABC`).
   *
   * O painel é sobre ALGO. Sem isto ele mantinha o turno da criação do projeto
   * na tela do agente, e só limpava no logout: o usuário lia uma resposta que
   * não era sobre o que ele estava vendo.
   */
  scopeKey: string;
  /** Como o escopo atual se chama. Vira o cabeçalho do grupo no transcrito. */
  scopeLabel: string;
  /**
   * Turnos já encerrados, do mais antigo ao mais recente.
   *
   * ÚNICO e CONTÍNUO: navegar não apaga mais. Antes, trocar de escopo zerava
   * o transcrito — o usuário perdia a resposta que acabara de ler só por ter
   * ido conferir o que o OS mudou. O que o escopo faz agora é AGRUPAR.
   */
  turns: HubTurn[];

  // --- turno em andamento ---
  operation: string | null;
  operationLabel: string | null;
  request: string;
  attachments: HubAttachmentRef[];
  understood: string;
  steps: OperationStep[];
  streamedText: string;
  /** O turno em andamento é resposta, não alteração. */
  answering: boolean;
  notices: HubNotice[];
  questions: string[];
  entity: {
    id: string;
    name: string;
    target: string;
    /** As regras que o turno criou ou alterou, para o usuário ir conferir. */
    touched?: Array<{ facet: string; code: string; label: string }>;
    /** O ofício que o turno também versionou, quando houve. */
    playbook?: { key: string; label: string; versionNumber: number };
  } | null;
  /** O que o turno em andamento custou. Zero até o provider responder. */
  costMicros: number;
  totalTokens: number;
  /** O log do turno em curso, do mais antigo ao mais recente. */
  trace: HubTraceLine[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  /** Última sequência aplicada — descarta evento duplicado ou fora de ordem. */
  lastSeq: number;
}

export const initialHubState: HubState = {
  open: false,
  scopeKey: '',
  scopeLabel: '',
  turns: [],
  operation: null,
  operationLabel: null,
  request: '',
  attachments: [],
  understood: '',
  steps: [],
  streamedText: '',
  answering: false,
  notices: [],
  questions: [],
  entity: null,
  costMicros: 0,
  totalTokens: 0,
  trace: [],
  status: 'idle',
  lastSeq: 0,
};

export type HubAction =
  | { type: 'panel.open' }
  | { type: 'panel.close' }
  /** A rota mudou de entidade: o painel passa a ser o daquele contexto. */
  | { type: 'scope.changed'; scopeKey: string; scopeLabel: string }
  /** O usuário enviou: o turno começa aqui, antes de o servidor responder. */
  | { type: 'request.sent'; content: string; attachments?: HubAttachmentRef[] }
  | {
      type: 'operation.started';
      seq: number;
      operation: string;
      label: string;
      steps: OperationStep[];
    }
  | { type: 'operation.plan'; seq: number; steps: OperationStep[] }
  /** Uma linha do que o OS está fazendo agora. */
  | { type: 'operation.trace'; seq: number; text: string; at: string }
  | { type: 'operation.answering'; seq: number }
  | { type: 'operation.progress'; seq: number; stepId: string; status: StepStatus; label?: string }
  | {
      type: 'operation.completed';
      seq: number;
      status: 'completed' | 'failed';
      errorCode?: string;
      errorMessage?: string;
      costMicros?: number;
      totalTokens?: number;
    }
  | { type: 'message.delta'; seq: number; text: string }
  | { type: 'notice'; seq: number; code: string; message: string }
  | { type: 'gaps'; seq: number; questions: string[] }
  | {
      type: 'entity';
      seq: number;
      id: string;
      name: string;
      target: string;
      /** As regras que este turno criou ou alterou. */
      touched?: Array<{ facet: string; code: string; label: string }>;
      /** O ofício que o turno também versionou. */
      playbook?: { key: string; label: string; versionNumber: number };
    }
  /** Falha antes de existir operação (rede, 4xx na abertura da conversa). */
  | { type: 'request.failed'; message: string }
  /**
   * O histórico da sessão de login, vindo do armazenamento.
   *
   * Só turnos ENCERRADOS: o turno em curso pertencia a um stream que morreu
   * com o recarregamento, e restaurá-lo mostraria um checklist girando para
   * sempre.
   */
  | { type: 'history.restored'; turns: HubTurn[] }
  | { type: 'reset' };

function isStale(state: HubState, seq: number): boolean {
  return seq <= state.lastSeq;
}

/**
 * Códigos que o usuário lê como informação, não como problema.
 *
 * `VALUE_ADJUSTED` significa "apliquei, corrigindo a forma" — é transparência
 * sobre uma correção bem-sucedida.
 */
const NOTICE_TONES: Record<string, HubNotice['tone']> = {
  VALUE_ADJUSTED: 'info',
  SOURCE_READ: 'info',
  LIMITATION_RECORDED: 'info',
  CONFLICT_DETECTED: 'warning',
  MUTATION_OUT_OF_SCOPE: 'warning',
};

function toNotice(seq: number, code: string, message: string): HubNotice {
  return { id: `${seq}:${code}`, code, message, tone: NOTICE_TONES[code] ?? 'warning' };
}

/** Fecha o turno atual, empurrando-o para o transcrito. */
function archive(state: HubState, status: 'completed' | 'failed'): HubTurn[] {
  if (!state.operationLabel && !state.request) return state.turns;

  return [
    ...state.turns,
    {
      id: `${state.turns.length}:${state.operation ?? 'op'}`,
      context: { key: state.scopeKey, label: state.scopeLabel },
      request: state.request,
      ...(state.attachments.length ? { attachments: state.attachments } : {}),
      ...(state.understood ? { understood: state.understood } : {}),
      operationLabel: state.operationLabel ?? '',
      steps: state.steps,
      answer: state.streamedText,
      answering: state.answering,
      notices: state.notices,
      questions: state.questions,
      status,
      entity: state.entity,
      costMicros: state.costMicros,
      totalTokens: state.totalTokens,
      trace: state.trace,
    },
  ];
}

export function hubReducer(state: HubState, action: HubAction): HubState {
  switch (action.type) {
    case 'panel.open':
      return { ...state, open: true };

    case 'scope.changed': {
      if (action.scopeKey === state.scopeKey) return state;

      // NAVEGAR NÃO APAGA O HISTÓRICO.
      //
      // Antes, trocar de escopo zerava o transcrito: o usuário perdia a
      // resposta que acabara de ler só por ter ido conferir o que o OS mudou —
      // e conferir é justamente o que o painel pede que ele faça. O histórico
      // é UM SÓ e contínuo; o escopo passa a AGRUPAR a leitura.
      //
      // O turno em CURSO é arquivado antes da troca: ele pertence ao contexto
      // em que foi pedido, não ao que o usuário abriu depois. Uma operação em
      // curso não é interrompida — ela termina no servidor —, mas a vista dela
      // fecha, porque acompanhar em tempo real algo de outra tela seria pior.
      return {
        ...initialHubState,
        open: state.open,
        scopeKey: action.scopeKey,
        scopeLabel: action.scopeLabel,
        turns: archive(state, state.status === 'failed' ? 'failed' : 'completed'),
      };
    }

    case 'operation.trace': {
      if (isStale(state, action.seq)) return state;
      return {
        ...state,
        lastSeq: action.seq,
        // Teto de 40 linhas: é log de UM turno, não histórico de sessão. Sem
        // teto, uma operação longa empurraria a resposta para fora da tela.
        trace: [...state.trace, { text: action.text, at: action.at }].slice(-40),
      };
    }

    case 'panel.close':
      // Fechar o painel não cancela a operação: ela continua e o usuário pode
      // reabrir para acompanhar.
      return { ...state, open: false };

    case 'history.restored':
      // Só na abertura: se já houve turno nesta montagem, o que está na tela é
      // mais novo que o guardado.
      if (state.turns.length > 0) return state;
      return { ...state, turns: action.turns };

    case 'reset':
      return initialHubState;

    case 'request.sent':
      // O turno anterior vai para o transcrito ANTES do novo começar — é o que
      // faz a segunda pergunta não apagar a resposta da primeira.
      return {
        ...state,
        open: true,
        turns: state.status === 'idle' ? state.turns : archive(state, state.status as never),
        request: action.content,
        attachments: action.attachments ?? [],
        understood: '',
        operation: null,
        operationLabel: null,
        steps: [],
        streamedText: '',
        answering: false,
        notices: [],
        questions: [],
        entity: null,
        costMicros: 0,
        totalTokens: 0,
        trace: [],
        status: 'running',
        lastSeq: 0,
      };

    case 'operation.started':
      if (isStale(state, action.seq)) return state;
      return {
        ...state,
        open: true,
        operation: action.operation,
        operationLabel: action.label,
        steps: action.steps,
        status: 'running',
        lastSeq: action.seq,
      };

    case 'operation.answering': {
      if (isStale(state, action.seq)) return state;
      // O OS entendeu a fala como pergunta. Some o checklist de trabalho: ele
      // descreveria passos que não vão acontecer, e o usuário leria isso como
      // "algo foi alterado".
      return { ...state, lastSeq: action.seq, answering: true, steps: [] };
    }

    case 'operation.plan': {
      // Resposta não tem plano de execução — o modelo pode mandar um por
      // hábito, e exibi-lo devolveria justamente o que o evento acima tirou.
      if (state.answering) return state;
      if (isStale(state, action.seq)) return state;
      // Substitui os passos genéricos pelo plano real. O checklist não pisca:
      // é a mesma lista, com rótulos que descrevem este pedido.
      return { ...state, lastSeq: action.seq, steps: action.steps };
    }

    case 'operation.progress': {
      if (isStale(state, action.seq)) return state;
      return {
        ...state,
        lastSeq: action.seq,
        steps: state.steps.map((step) =>
          step.id === action.stepId
            ? { ...step, status: action.status, label: action.label ?? step.label }
            : step,
        ),
      };
    }

    case 'operation.completed': {
      if (isStale(state, action.seq)) return state;
      return {
        ...state,
        lastSeq: action.seq,
        status: action.status,
        costMicros: action.costMicros ?? state.costMicros,
        totalTokens: action.totalTokens ?? state.totalTokens,
        notices: action.errorMessage
          ? [
              ...state.notices,
              {
                id: `${action.seq}:fail`,
                code: action.errorCode ?? 'INTERNAL_ERROR',
                message: action.errorMessage,
                tone: 'danger',
              },
            ]
          : state.notices,
        // Um passo que ficou pendurado em "running" ao fim da operação seria
        // um spinner eterno na tela.
        steps: state.steps.map((step) =>
          step.status === 'running' || step.status === 'pending'
            ? { ...step, status: action.status === 'completed' ? 'done' : 'failed' }
            : step,
        ),
      };
    }

    case 'message.delta':
      if (isStale(state, action.seq)) return state;
      return {
        ...state,
        lastSeq: action.seq,
        streamedText: state.streamedText + action.text,
      };

    case 'notice': {
      if (isStale(state, action.seq)) return state;
      // A leitura do pedido não é aviso: tem lugar próprio no turno.
      if (action.code === 'OPERATION_ROUTED') {
        return { ...state, lastSeq: action.seq, understood: action.message };
      }
      return {
        ...state,
        lastSeq: action.seq,
        notices: [...state.notices, toNotice(action.seq, action.code, action.message)],
      };
    }

    case 'gaps':
      if (isStale(state, action.seq)) return state;
      return { ...state, lastSeq: action.seq, questions: action.questions };

    case 'entity':
      if (isStale(state, action.seq)) return state;
      return {
        ...state,
        lastSeq: action.seq,
        entity: {
          id: action.id,
          name: action.name,
          target: action.target,
          touched: action.touched ?? [],
          ...(action.playbook ? { playbook: action.playbook } : {}),
        },
      };

    case 'request.failed':
      return {
        ...state,
        open: true,
        status: 'failed',
        steps: state.steps.map((step) =>
          step.status === 'pending' || step.status === 'running'
            ? { ...step, status: 'failed' }
            : step,
        ),
        notices: [
          ...state.notices,
          {
            id: `local:${state.notices.length}`,
            code: 'REQUEST_FAILED',
            message: action.message,
            tone: 'danger',
          },
        ],
      };

    default:
      return state;
  }
}
