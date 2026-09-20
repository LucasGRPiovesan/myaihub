import type { HubEvent, HubScope } from '@myaihub/shared';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRefreshAgents } from '../agents/agents.api';
import { useRefreshCampaigns } from '../campaigns/campaigns.api';
import { useRefreshPlaybooks } from '../admin/admin.api';
import { useRefreshProjects } from '../projects/projects.api';
import { useRefreshSpend } from '../usage/usage.api';
import { useHubOperationStream, useSendHubMessage, useStartConversation } from './hub.api';
import { useCurrentUser } from '../auth/auth.api';
import { forgetHubHistory, readHubHistory, writeHubHistory } from './hub-persistence';
import {
  hubReducer,
  initialHubState,
  type HubAction,
  type HubAttachmentRef,
  type HubState,
} from './hub-state';
import { playOutcome } from './sound';

interface HubContextValue {
  state: HubState;
  dispatch: React.Dispatch<HubAction>;
  open: () => void;
  close: () => void;
  /** Envia uma mensagem ao OS, criando a conversa se ainda não houver uma. */
  send: (
    content: string,
    options?: {
      scope?: HubScope;
      scopeId?: string;
      operation?: string;
      /** O usuário clicou a ação — não é só a oferta da tela. */
      operationPicked?: boolean;
      attachmentIds?: string[];
      /** As imagens, para o turno mostrar o que foi junto do pedido. */
      attachments?: HubAttachmentRef[];
      playbookKey?: string;
      /** "Atualizar pelo ofício": reaplica o piso curado sobre o agente. */
      syncCraft?: boolean;
    },
  ) => Promise<void>;
  sending: boolean;
  /**
   * Chamado pelo painel quando a rota muda de entidade.
   *
   * O rótulo vem junto porque é ele que o transcrito usa como cabeçalho do
   * grupo: o painel guarda UM histórico e o organiza por onde cada pergunta foi
   * feita.
   */
  enterScope: (scopeKey: string, scopeLabel: string) => void;
  /**
   * O Lab publica aqui a conversa de teste em andamento.
   *
   * É o que permite ao OS LER o que aconteceu em vez de exigir que o usuário
   * descreva. Antes, corrigir um comportamento significava narrar o diálogo ou
   * colar um print — e a correção saía tão boa quanto a descrição. O agente
   * errou na frente dos dois; só um dos dois estava vendo.
   *
   * Vive no provider, e não num store novo, porque quem envia é o painel: um
   * segundo lugar guardando a mesma conversa divergiria na primeira tela que
   * esquecesse de atualizá-lo.
   */
  publishTestTranscript: (turns: TestTurn[] | null) => void;
  /**
   * Em QUEM o S.O está trabalhando agora — e quanto ele já andou.
   *
   * A tela do alvo usa isto para duas coisas que precisam do mesmo sinal: se
   * fechar enquanto a operação corre (testar um agente que está sendo
   * reescrito produz conversa sobre uma configuração que já não existe) e
   * reiniciar a conversa UMA vez, no fim — e não a cada versão intermediária,
   * que era o que fazia o agente se apresentar de novo no meio do trabalho,
   * pagando uma saudação por rodada de correção.
   */
  working: { scope: HubScope; scopeId: string | null; steps: number } | null;
}

/** Um turno da conversa de teste, como o Lab o tem na tela. */
export interface TestTurn {
  role: 'user' | 'assistant';
  content: string;
}

const HubContext = createContext<HubContextValue | null>(null);

/**
 * Estado do painel vivo, ligado ao stream de eventos do OS.
 *
 * Context em vez de store global: é estado de UI, vive enquanto o shell vive.
 * Estado de servidor continua no TanStack Query (§41).
 */
export function HubProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(hubReducer, initialHubState);
  const { data: user } = useCurrentUser();
  const userId = user?.id ?? null;

  /**
   * O transcrito de volta, na sessão de login.
   *
   * Sem isto a conversa com o OS seria a única do sistema que se perde num
   * F5 — logo depois de as conversas do agente terem deixado de se perder.
   */
  /**
   * Já tentamos ler o que estava guardado?
   *
   * Sem esta trava, o efeito de GRAVAR rodava no mesmo commit em que o usuário
   * chegava — com `turns` ainda vazio — e sobrescrevia o histórico com `[]`
   * antes de a restauração ser aplicada. No caminho feliz o valor voltava logo
   * depois; bastava a aba fechar, navegar ou perder a sessão nesse intervalo
   * para o histórico sumir de vez. Ler ANTES de gravar não é otimização: é a
   * ordem que torna a perda impossível.
   */
  const restored = useRef(false);

  useEffect(() => {
    if (!userId) return;
    const guardado = readHubHistory(userId);
    if (guardado.length > 0) dispatch({ type: 'history.restored', turns: guardado });
    restored.current = true;
  }, [userId]);

  // Grava só o que já ENCERROU. O turno em curso não sobrevive ao
  // recarregamento de jeito nenhum: o stream dele morre junto.
  useEffect(() => {
    if (!userId || !restored.current) return;
    writeHubHistory(userId, state.turns);
  }, [userId, state.turns]);

  /**
   * TROCAR DE USUÁRIO apaga o histórico do anterior.
   *
   * O gatilho era a AUSÊNCIA de usuário depois de ter havido um — e isso
   * abrangia demais. Qualquer piscada da sessão (uma consulta de `/me` que
   * volta vazia, a rotação de refresh token com duas abas abertas, um erro de
   * rede) parecia logout, e a reação era apagar TODO histórico guardado, de
   * todos os usuários. Foi assim que duplicar uma aba zerou a conversa.
   *
   * O que a regra precisa garantir é uma coisa só: numa máquina compartilhada,
   * quem entra depois não lê a conversa de quem saiu. Isso é a troca de
   * usuário — e ela é observável sem depender de o `null` significar logout.
   * O logout explícito apaga por conta própria, no `useLogout`.
   */
  const previousUserId = useRef<string | null>(null);
  useEffect(() => {
    const anterior = previousUserId.current;
    if (userId) previousUserId.current = userId;

    if (!anterior || !userId || anterior === userId) return;

    forgetHubHistory(anterior);
    dispatch({ type: 'reset' });
  }, [userId]);
  // Conversa POR ESCOPO: voltar para o projeto retoma a conversa dele, em vez
  // de continuar a do agente que foi aberto no meio.
  const conversations = useRef(new Map<string, string>());
  const [operationId, setOperationId] = useState<string | null>(null);
  /**
   * O alvo da operação EM CURSO.
   *
   * Guardado aqui, e não derivado de `state.entity`, porque precisa existir
   * desde o ENVIO: a tela do agente tem que fechar no instante em que o
   * trabalho começa, não quando a primeira versão é gravada — que já é depois
   * de o modelo ter respondido.
   */
  const [working, setWorking] = useState<{ scope: HubScope; scopeId: string | null } | null>(null);

  const startConversation = useStartConversation();
  const sendMessage = useSendHubMessage();
  // `ref` e não estado: mudar a cada turno do Lab re-renderizaria o painel
  // inteiro por uma informação que só é lida no momento de enviar.
  const testTranscript = useRef<TestTurn[] | null>(null);
  // Este turno tocou em dado? Só então vale invalidar as queries no fim.
  const changed = useRef(false);
  const refreshProjects = useRefreshProjects();
  const refreshAgents = useRefreshAgents();
  const refreshCampaigns = useRefreshCampaigns();
  const refreshPlaybooks = useRefreshPlaybooks();
  const refreshSpend = useRefreshSpend();

  const handleEvent = useCallback(
    (event: HubEvent) => {
      switch (event.type) {
        case 'operation.started':
          dispatch({
            type: 'operation.started',
            seq: event.seq,
            operation: event.operation,
            label: event.label,
            steps: event.steps,
          });
          changed.current = false;
          break;
        case 'operation.answering':
          dispatch({ type: 'operation.answering', seq: event.seq });
          break;
        case 'operation.plan':
          dispatch({ type: 'operation.plan', seq: event.seq, steps: event.steps });
          break;
        case 'operation.trace':
          dispatch({ type: 'operation.trace', seq: event.seq, text: event.text, at: event.at });
          break;
        case 'operation.progress':
          dispatch({
            type: 'operation.progress',
            seq: event.seq,
            stepId: event.stepId,
            status: event.status,
            ...(event.label ? { label: event.label } : {}),
          });
          break;
        case 'operation.completed':
          dispatch({
            type: 'operation.completed',
            seq: event.seq,
            status: event.status,
            ...(event.errorCode ? { errorCode: event.errorCode } : {}),
            ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
            ...(event.costMicros !== undefined ? { costMicros: event.costMicros } : {}),
            ...(event.totalTokens !== undefined ? { totalTokens: event.totalTokens } : {}),
          });
          // Só quando algo REALMENTE mudou. Recarregar depois de uma pergunta
          // faria a tela piscar como se o OS tivesse mexido nela.
          if (changed.current) {
            refreshProjects();
            refreshAgents();
            refreshCampaigns();
          }
          // O gasto do mês mudou: o turno que acabou custou alguma coisa. É o
          // único momento em que ele muda, então é o único em que se recarrega.
          refreshSpend();
          // O trabalho acabou: a tela do alvo volta a ser do usuário. É AQUI
          // que o Lab reinicia a conversa — uma vez, no fim, e não a cada
          // versão intermediária.
          setWorking(null);
          /*
            E é aqui que o som toca — no ÚNICO ponto em que uma operação
            termina, seja bem ou mal.

            Uma operação leva de 8 a 40 segundos e ninguém fica olhando: quem
            pediu vai para outra aba e volta quando lembra. O som devolve o
            instante do fim sem exigir a tela à vista, e o timbre diz QUAL fim
            foi — anunciar erro com o som do acerto ensina a ignorar o som.
          */
          playOutcome(event.status);
          // Encerrada a operação, o stream não tem mais o que entregar. Deixá-lo
          // aberto acumula uma conexão SSE viva por operação executada.
          setOperationId(null);
          break;
        case 'message.delta':
          dispatch({ type: 'message.delta', seq: event.seq, text: event.text });
          break;
        case 'workspace.patch': {
          changed.current = true;
          // O miolo reage AQUI, não só no fim: este evento chega assim que a
          // versão é gravada, então a tela ao lado muda enquanto o painel ainda
          // está trabalhando — que é o comportamento de painel vivo (§28).
          refreshProjects();
          refreshAgents();
          refreshCampaigns();
          // O ofício também mudou: sem isto a listagem do admin segue mostrando
          // a versão velha até alguém recarregar a página.
          if (event.playbook) refreshPlaybooks();
          // Excluída: recarregar basta. Navegar até ela abriria "não encontrado".
          if (event.removed) break;

          const patch = event.patch as { name?: string } | null;
          dispatch({
            type: 'entity',
            seq: event.seq,
            id: event.entityId,
            name: patch?.name ?? '',
            target: event.target,
            ...(event.touched?.length ? { touched: event.touched } : {}),
            ...(event.playbook ? { playbook: event.playbook } : {}),
          });
          break;
        }
        case 'operation.gaps':
          dispatch({ type: 'gaps', seq: event.seq, questions: event.questions });
          break;
        case 'validation.warning':
          dispatch({
            type: 'notice',
            seq: event.seq,
            code: event.code,
            message: event.message,
          });
          break;
        default:
          break;
      }
    },
    [refreshAgents, refreshCampaigns, refreshProjects, refreshSpend],
  );

  useHubOperationStream(operationId, handleEvent);

  const send = useCallback(
    async (
      content: string,
      options?: {
        scope?: HubScope;
        scopeId?: string;
        operation?: string;
        operationPicked?: boolean;
        attachmentIds?: string[];
        /** As imagens, para o turno mostrar o que foi junto do pedido. */
        attachments?: HubAttachmentRef[];
        /** Ofício classificado no briefing — só na criação de agente. */
        playbookKey?: string;
        syncCraft?: boolean;
      },
    ) => {
      dispatch({
        type: 'request.sent',
        content,
        ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
      });
      setWorking({ scope: options?.scope ?? 'ROOT', scopeId: options?.scopeId ?? null });

      try {
        // Conversa é por ESCOPO: falar com o hub sobre outro agente não pode
        // continuar a conversa do anterior — o contexto carregado seria o errado.
        const scopeKey = `${options?.scope ?? 'ROOT'}:${options?.scopeId ?? ''}`;
        let target = conversations.current.get(scopeKey) ?? null;

        if (!target) {
          const conversation = await startConversation.mutateAsync({
            scope: options?.scope ?? 'ROOT',
            ...(options?.scopeId ? { scopeId: options.scopeId } : {}),
          });
          target = conversation.id;
          conversations.current.set(scopeKey, conversation.id);
        }

        const { operation } = await sendMessage.mutateAsync({
          conversationId: target,
          content,
          ...(options?.operation ? { operation: options.operation } : {}),
          ...(options?.operationPicked ? { operationPicked: true } : {}),
          ...(options?.attachmentIds?.length ? { attachmentIds: options.attachmentIds } : {}),
          ...(options?.playbookKey ? { playbookKey: options.playbookKey } : {}),
          ...(options?.syncCraft ? { syncCraft: true } : {}),
          // A conversa de teste vai junto quando existe e o escopo é do agente:
          // é sobre ELE que o usuário está falando.
          ...(options?.scope === 'AGENT' && testTranscript.current?.length
            ? { testTranscript: testTranscript.current.slice(-12) }
            : {}),
        });
        // Abre o stream: o backend responde antes de terminar, então o painel
        // acompanha o trabalho acontecendo (§28).
        setOperationId(operation.id);
      } catch (caught) {
        setWorking(null);
        // Falha ANTES de a operação começar: não passa pelo `operation.completed`,
        // e para o usuário é o mesmo fim — o pedido dele morreu.
        playOutcome('failed');
        dispatch({
          type: 'request.failed',
          message:
            caught instanceof Error ? caught.message : 'Não foi possível falar com o MyAIHub.',
        });
      }
    },
    [sendMessage, startConversation],
  );

  const value = useMemo<HubContextValue>(
    () => ({
      state,
      dispatch,
      open: () => dispatch({ type: 'panel.open' }),
      close: () => dispatch({ type: 'panel.close' }),
      send,
      sending: startConversation.isPending || sendMessage.isPending,
      enterScope: (scopeKey: string, scopeLabel: string) =>
        dispatch({ type: 'scope.changed', scopeKey, scopeLabel }),
      publishTestTranscript: (turns: TestTurn[] | null) => {
        testTranscript.current = turns;
      },
      // O número de linhas do log vira a INTENSIDADE da animação de espera: a
      // tela pulsa quando algo acontece de verdade, em vez de fingir progresso.
      working: working ? { ...working, steps: state.trace.length } : null,
    }),
    [state, send, startConversation.isPending, sendMessage.isPending, working],
  );

  return <HubContext value={value}>{children}</HubContext>;
}

export function useHub(): HubContextValue {
  const context = use(HubContext);
  if (!context) {
    throw new Error('useHub precisa estar dentro de <HubProvider>.');
  }
  return context;
}
