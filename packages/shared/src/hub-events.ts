/**
 * Live UI Event Protocol (§32).
 *
 * O MyAIHub não devolve só texto: ele emite eventos que alteram a interface
 * enquanto trabalha. Este é o contrato entre o stream SSE da API e o reducer
 * do painel vivo.
 *
 * Todo evento carrega `seq` monotônico por operação. É o que permite descartar
 * duplicata e evento fora de ordem quando o SSE reconecta e faz replay — sem
 * isso, um refresh no meio de uma operação duplica o texto na tela.
 */

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OperationStep {
  id: string;
  label: string;
  status: StepStatus;
}

interface BaseHubEvent {
  seq: number;
  operationId: string;
}

export type HubEvent =
  | (BaseHubEvent & { type: 'message.delta'; text: string })
  | (BaseHubEvent & {
      type: 'operation.started';
      operation: string;
      label: string;
      steps: OperationStep[];
    })
  | (BaseHubEvent & {
      type: 'operation.progress';
      stepId: string;
      status: StepStatus;
      label?: string;
    })
  /**
   * O plano que o OS montou para ESTE pedido, substituindo os passos genéricos.
   *
   * Chega uma vez, quando o modelo responde — não custa requisição extra. O
   * painel continua marcando o progresso sozinho a partir dos eventos que já
   * existem; o que muda é que os rótulos passam a ser os do trabalho real, em
   * vez de três frases fixas iguais em toda operação.
   */
  | (BaseHubEvent & { type: 'operation.plan'; steps: OperationStep[] })
  /**
   * Uma linha do que o OS está fazendo AGORA.
   *
   * O painel tinha três passos e um giro: entre "interpretando o pedido" e
   * "salvando", o usuário esperava dezenas de segundos sem nada dizendo o que
   * estava acontecendo — e é justamente ali que mora a chamada ao modelo, a
   * parte cara e a que às vezes falha.
   *
   * É LOG, não estado: cada linha descreve algo que ACONTECEU, com carimbo. O
   * painel as empilha sob o passo em curso e as guarda no turno, para quem
   * rolar para trás entender por que aquele turno custou o que custou.
   *
   * Custo zero: são eventos que o servidor já podia emitir, no mesmo canal SSE.
   */
  | (BaseHubEvent & { type: 'operation.trace'; text: string; at: string })
  /**
   * O turno é uma RESPOSTA, não uma alteração.
   *
   * O painel do OS não é só um executor de comandos: o usuário pergunta, compara
   * e pede opinião. Sem este evento a UI anunciava "Ajustando o agente" e exibia
   * um checklist de trabalho enquanto o OS apenas respondia — e o usuário, com
   * razão, achava que algo tinha sido alterado sem ele pedir.
   */
  | (BaseHubEvent & { type: 'operation.answering' })
  | (BaseHubEvent & {
      type: 'operation.completed';
      status: 'completed' | 'failed';
      /** Presente na falha: o que deu errado, em linguagem de usuário. */
      errorCode?: string;
      errorMessage?: string;
      /**
       * O que esta operação custou.
       *
       * Vai no evento, e não numa tela de relatório: o usuário decide o próximo
       * passo com o preço do anterior à vista. Custo que só aparece na fatura
       * não é informação, é surpresa.
       */
      costMicros?: number;
      totalTokens?: number;
    })
  | (BaseHubEvent & {
      type: 'workspace.patch';
      target: string;
      /** Id da entidade tocada — a UI usa para levar o usuário até ela. */
      entityId: string;
      patch: unknown;
      /**
       * As REGRAS que este turno criou ou alterou.
       *
       * Sem isto o painel diz "ajustei a estratégia ST01" e o usuário precisa
       * caçar a ST01 em sete facetas para conferir o que foi escrito. Anunciar
       * uma mudança sem oferecer o caminho até ela é pedir confiança no lugar
       * de dar evidência — e foi assim que "ajustei" virou uma palavra em que
       * não dava para confiar.
       */
      touched?: Array<{ facet: string; code: string; label: string }>;
      /**
       * O playbook que este turno também versionou, quando houve.
       *
       * Correção de OFÍCIO gera DUAS versões — uma no agente, uma no piso do
       * papel. A segunda acontecia em silêncio: nada na tela dizia que o ofício
       * de todas as contas tinha mudado, e a listagem do admin continuava
       * mostrando a versão velha até alguém recarregar.
       */
      playbook?: { key: string; label: string; versionNumber: number };
      /**
       * A entidade deixou de existir (o S.O excluiu).
       *
       * As listas precisam recarregar, mas levar o usuário até ela seria abrir
       * uma tela de "não encontrado" como resposta a um pedido que deu certo.
       */
      removed?: boolean;
    })
  /**
   * Perguntas que o OS identificou como faltando.
   *
   * A policy pede ao modelo que registre lacunas em `gaps` em vez de inventar
   * informação — mas isso só vale se o usuário LER as perguntas. Sem este
   * evento, o modelo deixava de inventar e ninguém ficava sabendo o que faltou.
   */
  | (BaseHubEvent & { type: 'operation.gaps'; questions: string[] })
  | (BaseHubEvent & { type: 'configuration.proposed'; proposalId: string; summary: string })
  | (BaseHubEvent & { type: 'configuration.applied'; changeId: string; summary: string })
  | (BaseHubEvent & { type: 'validation.warning'; code: string; message: string });

export type HubEventType = HubEvent['type'];

/** Nome do evento SSE. Um só canal mantém a ordem entre tipos diferentes. */
export const HUB_SSE_EVENT = 'hub';
