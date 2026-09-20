import {
  ArrowRight,
  ChevronsLeftRight,
  Loader2,
  ImagePlus,
  Send,
  Sparkles,
  TriangleAlert,
  Volume2,
  VolumeOff,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useLocation } from 'react-router';
import { Button, IconButton, cx } from '../../design-system/primitives';
import { useApplyMutations } from '../canonical/manual.api';
import { AgentBriefing, type BriefingResult } from './AgentBriefing';
import { imagesFromClipboard, useAttachments, type PendingAttachment } from './attachments';
import { resolveHubContext, type QuickAction } from './contextual-actions';
import { useHub } from './HubProvider';
import type { HubTurn } from './hub-state';
import { ContextDivider, TurnView } from './HubTranscript';
import { isSoundEnabled, playOutcome, setSoundEnabled } from './sound';
import { useHubWorkspace } from './useHubWorkspace';
import { prioritizeActions, type WorkspaceSummary } from './workspace';
import { costTitle, formatBrl } from '../usage/cost';
import { useSpend } from '../usage/usage.api';
import { ModelPicker } from '../models/ModelPicker';

/**
 * Onde o usuário está e o que falta.
 *
 * É o que separa um sistema operacional de uma caixa de texto: o painel abre já
 * sabendo o estado, em vez de esperar a pergunta. Nada aqui custa uma chamada ao
 * modelo — tudo é derivado dos dados que a página já carregou (§31).
 */
function WorkspaceHeader({
  workspace,
  onPickAction,
}: {
  workspace: WorkspaceSummary;
  onPickAction: (action: QuickAction) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[15px] font-semibold tracking-tight">{workspace.title}</p>
        {workspace.subtitle && (
          <p className="mt-0.5 text-[13px] text-text-subtle">{workspace.subtitle}</p>
        )}
      </div>

      {workspace.facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {workspace.facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline gap-1">
              {fact.value && (
                <dd
                  className={cx(
                    'font-medium tabular-nums',
                    fact.empty ? 'text-text-subtle' : 'text-text',
                  )}
                >
                  {fact.value}
                </dd>
              )}
              <dt className={cx(fact.empty ? 'text-text-subtle' : 'text-text-muted')}>
                {fact.label}
              </dt>
            </div>
          ))}
        </dl>
      )}

      {workspace.gaps.length > 0 && (
        <ul className="flex flex-col gap-2">
          {workspace.gaps.map((gap) => (
            <li
              key={gap.id}
              className={cx(
                'rounded-[var(--radius-control)] px-3 py-2 text-[13px]',
                gap.blocking
                  ? 'bg-surface-sunken text-warning'
                  : 'bg-surface-sunken text-text-muted',
              )}
            >
              <span className="flex items-start gap-2">
                {gap.blocking && <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
                <span>{gap.message}</span>
              </span>
              {gap.action && (
                <button
                  type="button"
                  onClick={() => onPickAction(gap.action as QuickAction)}
                  className="mt-1.5 inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  {gap.action.label}
                  <ArrowRight aria-hidden className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * O ACUMULADO do mês, no cabeçalho.
 *
 * O custo por turno já aparecia sob cada operação, mas ninguém soma doze linhas
 * de cabeça: o usuário lia "R$ 0,0134" repetidas vezes sem saber se tinha
 * gastado centavos ou dezenas de reais. Custo que só aparece na fatura não é
 * informação, é surpresa — a mesma razão pela qual o valor do turno existe.
 */
/**
 * Silenciar o aviso sonoro.
 *
 * Fica no cabeçalho do painel — que é de onde o som sai — e não numa tela de
 * preferências: quem quer desligar está incomodado AGORA, e mandá-lo procurar
 * um ajuste noutro lugar é pior que não ter o botão. A escolha é da máquina,
 * não da conta: o mesmo usuário quer som em casa e silêncio numa reunião.
 */
function SoundToggle() {
  const [enabled, setEnabled] = useState(isSoundEnabled);

  return (
    <IconButton
      label={enabled ? 'Silenciar aviso sonoro' : 'Ativar aviso sonoro'}
      className="size-9"
      onClick={() => {
        const next = !enabled;
        setSoundEnabled(next);
        setEnabled(next);
        // Ligar TOCA o som: sem ouvir, o botão pede um voto sobre algo que a
        // pessoa não conhece — e é o clique que libera o áudio no navegador.
        if (next) playOutcome('completed', { force: true });
      }}
    >
      {enabled ? (
        <Volume2 aria-hidden className="size-[18px]" />
      ) : (
        <VolumeOff aria-hidden className="size-[18px] text-text-subtle" />
      )}
    </IconButton>
  );
}

function SpendBadge() {
  const { data: spend } = useSpend();
  if (!spend || spend.month.costMicros === 0) return null;

  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] tabular-nums text-text-muted"
      title={`${costTitle(spend.month.costMicros, spend.rate)} · ${spend.month.calls} chamadas ao modelo neste mês`}
    >
      {formatBrl(spend.month.costMicros, spend.rate)} no mês
    </span>
  );
}

/**
 * O transcrito em GRUPOS de contexto.
 *
 * O histórico é um só e contínuo — navegar não apaga mais. O que o contexto
 * faz é organizar a leitura: três perguntas sobre um agente, depois duas
 * sobre um projeto, cada bloco sob o nome de onde foi feito.
 *
 * Sem o agrupamento, o histórico único vira uma lista plana em que a resposta
 * sobre um agente aparece colada em outra sobre um projeto, e o usuário lê a
 * segunda achando que fala da primeira.
 *
 * Agrupa por SEQUÊNCIA, não por chave: voltar ao mesmo agente depois de
 * passar por um projeto abre um grupo NOVO. É o que aconteceu de fato, e
 * juntar as duas visitas num bloco só contaria uma ordem que não existiu.
 */
function groupByContext(turns: HubTurn[]): Array<{ key: string; label: string; turns: HubTurn[] }> {
  const grupos: Array<{ key: string; label: string; turns: HubTurn[] }> = [];

  for (const turn of turns) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.key === turn.context.key) {
      ultimo.turns.push(turn);
      continue;
    }
    grupos.push({ key: turn.context.key, label: turn.context.label, turns: [turn] });
  }

  return grupos;
}

function QuickActions({
  actions,
  onPick,
  disabled,
}: {
  actions: QuickAction[];
  onPick: (action: QuickAction) => void;
  disabled: boolean;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onPick(action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Miniaturas do que foi colado.
 *
 * O preview aparece com o `blob:` local, antes de o upload terminar: esperar o
 * servidor para mostrar o que a pessoa acabou de colar faria a interface parecer
 * que perdeu a imagem.
 */
function AttachmentStrip({
  items,
  onRemove,
}: {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ul className="mb-2 flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.key} className="relative">
          <img
            src={item.previewUrl}
            alt={item.fileName}
            className={cx(
              'size-16 rounded-[var(--radius-control)] border border-border object-cover',
              item.status === 'uploading' && 'opacity-50',
              item.status === 'failed' && 'opacity-40 ring-1 ring-danger',
            )}
          />
          {item.status === 'uploading' && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 aria-hidden className="size-4 animate-spin text-accent" />
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={`Remover ${item.fileName}`}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-[var(--shadow-card)] transition-colors hover:text-text"
          >
            <X aria-hidden className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Falhas de upload, em texto — a miniatura apagada sozinha não explica nada. */
function AttachmentErrors({ items }: { items: PendingAttachment[] }) {
  const failed = items.filter((item) => item.status === 'failed');
  if (failed.length === 0) return null;

  return (
    <ul className="mb-2 flex flex-col gap-1">
      {failed.map((item) => (
        <li key={item.key} role="alert" className="text-[11px] text-danger">
          {item.fileName}: {item.error ?? 'não foi possível enviar.'}
        </li>
      ))}
    </ul>
  );
}

/**
 * O que escrever, por operação.
 *
 * Havia um placeholder só, falando de negócio, e ele aparecia também na tela do
 * agente — pedindo ao usuário exatamente o texto errado para o que ele ia fazer
 * ali. Reduzir a folha em branco só ajuda se apontar para a folha certa.
 */
const PLACEHOLDERS: Record<string, string> = {
  'project.create_from_brief':
    'Descreva seu negócio: o que ele faz, para quem, e o que o diferencia.\n' +
    'Você também pode colar o endereço do site — eu leio a página.',
  'project.refine_profile': 'O que mudou ou o que ficou faltando no perfil do negócio.',
  'agent.create': 'Que agente você quer, e o que ele precisa saber fazer.',
  'agent.configure':
    'Diga a INTENÇÃO, não o texto final: “seja mais direto”, “não peça o nome de\n' +
    'cara”, “esse público não lê parágrafo”. Eu escrevo a configuração.',
  'campaign.create': 'O que esta campanha precisa alcançar, e com quem ela fala.',
  'campaign.refine_strategy': 'O que ajustar na estratégia desta campanha.',
  'campaign.configure_cta': 'Para onde a pessoa deve ir, e quando oferecer.',
};

const DEFAULT_PLACEHOLDER = 'Diga o que você quer. Eu cuido da implementação técnica.';

/** Rótulo de cada operação, para o usuário saber o que vai rodar. */
const OPERATION_LABELS: Record<string, string> = {
  'project.create_from_brief': 'criar projeto',
  'project.refine_profile': 'refinar perfil',
  'agent.create': 'criar agente',
  'agent.configure': 'configurar agente',
  'campaign.create': 'criar campanha',
  'campaign.refine_strategy': 'ajustar estratégia',
  'campaign.configure_cta': 'configurar CTA',
};

export interface HubPanelProps {
  firstName: string;
  hasProjects: boolean;
  onClose?: () => void;
  /** Só no desktop, onde existe espaço para alargar. */
  expanded?: boolean;
  onToggleExpand?: () => void;
}

/**
 * Painel do MyAIHub (§28, §30).
 *
 * Ele é o sistema operacional do produto, não um assistente lateral. Por isso
 * abre mostrando ESTADO e LACUNA antes de qualquer campo de texto: quem delegou
 * a implementação técnica não deveria precisar descobrir sozinho qual é o
 * próximo passo.
 */
export function HubPanel({
  firstName,
  hasProjects,
  onClose,
  expanded = false,
  onToggleExpand,
}: HubPanelProps) {
  const { state, close, send, sending, enterScope } = useHub();
  const { pathname } = useLocation();
  const [draft, setDraft] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const attachments = useAttachments();

  const context = resolveHubContext({ pathname, firstName, hasProjects });
  const workspace = useHubWorkspace(context.scope, context.scopeId);
  const busy = sending || state.status === 'running';

  // Navegar troca o CONTEXTO do painel — e só ele. O histórico é único e
  // contínuo; o escopo passa a agrupar a leitura, em vez de zerá-la.
  //
  // O rótulo vem do workspace, que é quem já sabe o nome do que está na tela.
  // Sem ele o cabeçalho do grupo diria "AGENT:01ABC", que não é nome de nada.
  const scopeKey = `${context.scope}:${context.scopeId ?? ''}`;
  const scopeLabel = workspace.title;
  useEffect(() => {
    enterScope(scopeKey, scopeLabel);
    // A escolha de operação também é do escopo ANTERIOR. Mantê-la fazia o
    // painel disparar a operação de outra tela com o id desta — o servidor
    // recusa isso agora, mas o certo é a escolha morrer junto com o assunto.
    setPickedOperation(null);
    setBriefing(false);
  }, [scopeKey, scopeLabel, enterScope]);

  // O projeto da rota: a campanha criada mora sob ele, e sem isso o painel não
  // teria como montar o link para o que acabou de nascer.
  const projectId = /^\/projetos\/([^/]+)/.exec(pathname)?.[1];

  const [pickedOperation, setPickedOperation] = useState<string | null>(null);
  /**
   * Criar agente é um FLUXO, não uma frase.
   *
   * Enquanto o briefing está aberto, o composer some: um campo livre ao lado de
   * um formulário de perguntas convida o usuário a responder no lugar errado.
   */
  const [briefing, setBriefing] = useState(false);
  const applyEngagement = useApplyMutations('agents');
  /** Escolhas do briefing esperando o agente nascer para serem aplicadas. */
  const pendingInitiator = useRef<{
    initiator: 'USER' | 'AGENT';
    name: string | null;
    suggestedRepliesEnabled: boolean;
  } | null>(null);
  /**
   * O último envio, guardado para poder ser refeito.
   *
   * Sobrecarga do provider é transitória — passa em segundos. Sem isto, a
   * saída de quem levou "o modelo está sobrecarregado agora" era redigitar o
   * pedido inteiro, igual ao Lab antes de ganhar o mesmo botão.
   */
  const lastSend = useRef<{ content: string; options: Parameters<typeof send>[1] } | null>(null);
  // As ações que resolvem lacuna vêm primeiro: sugerir o acabamento antes da
  // fundação é pior do que não sugerir nada.
  const actions = prioritizeActions(workspace, context.actions);
  const operation = pickedOperation ?? actions[0]?.operation;

  /*
    A ESCOLHA DE OPERAÇÃO MORRE QUANDO A TELA DEIXA DE OFERECÊ-LA.

    Limpar por ESCOPO não bastava: `/projetos/:id` e `/projetos/:id/campanhas`
    são o MESMO escopo `PROJECT:<id>`, então o chip atravessava a navegação
    entre elas. Medido: o usuário refinou o perfil, foi para Campanhas — cuja
    única ação é "Criar campanha" — pediu a campanha, e o painel disparou
    `project.refine_profile` com o texto do briefing dela. A operação rodou, não
    tinha como criar campanha nenhuma, e respondeu descrevendo o que FARIA. A
    tela ficou vazia e a resposta parecia um "pronto".

    A régua certa não é o escopo, é a OFERTA: uma operação que esta tela não
    oferece não é uma escolha do usuário aqui, é sobra da tela anterior. Lista
    vazia não limpa nada — ela significa que o workspace ainda está carregando,
    e não que a operação deixou de valer.
  */
  const operationsOffered = actions.map((action) => action.operation).join('|');
  useEffect(() => {
    if (!pickedOperation || operationsOffered === '') return;
    if (!operationsOffered.split('|').includes(pickedOperation)) setPickedOperation(null);
  }, [operationsOffered, pickedOperation]);

  /*
    `state.request` entra na lista de dependências: ele é o que aparece na tela
    no INSTANTE do envio (a fala do usuário, via `TurnView` com
    `request: state.request`), antes de qualquer coisa vir do servidor. Sem
    ele, mandar uma mensagem não disparava rolagem nenhuma — só quando o
    rastro, o texto ou os avisos começavam a chegar — e o usuário via a própria
    fala sumir tela abaixo até a resposta começar.
  */
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [
    state.turns.length,
    state.trace.length,
    state.streamedText,
    state.notices.length,
    state.request,
  ]);

  /**
   * A INICIATIVA é gravada em CÓDIGO, não deixada a cargo do modelo.
   *
   * O usuário escolheu em dois botões; uma escolha explícita que depende de o
   * modelo lembrar de traduzi-la em mutação é uma escolha que às vezes se perde.
   * Não é porta dos fundos: é a mesma `CanonicalMutation` tipada, pelo mesmo
   * aplicador, com `source: 'USER'` — que é exatamente o que ela foi.
   */
  const entityId = state.entity?.target === 'AGENT' ? state.entity.id : null;
  useEffect(() => {
    const pending = pendingInitiator.current;
    if (!entityId || !pending) return;
    // Limpa ANTES de disparar: o StrictMode roda o efeito duas vezes, e a
    // segunda gravaria uma versão idêntica só para constar no histórico.
    pendingInitiator.current = null;

    // Nome é FATO, não julgamento — mesma mutação já usada pela tela (ainda
    // sem UI própria) para renomear depois. Vai na MESMA versão da
    // iniciativa/liga-desliga: uma escolha explícita do briefing, uma versão
    // só, não uma por campo.
    applyEngagement.mutate({
      id: entityId,
      mutations: [
        {
          kind: 'SET_AGENT_ENGAGEMENT',
          initiator: pending.initiator,
          suggestedRepliesEnabled: pending.suggestedRepliesEnabled,
        },
        ...(pending.name ? [{ kind: 'SET_AGENT_IDENTITY' as const, name: pending.name }] : []),
      ],
      reason: 'Definido no briefing de criação',
    });
  }, [entityId, applyEngagement]);

  function focusComposer(text: string): void {
    setDraft(text);
    composer.current?.focus();
  }

  function pickAction(action: QuickAction): void {
    // A ação NÃO envia: preenche o começo da frase e devolve o cursor. Enviar
    // sozinha produziria configuração que o usuário não escreveu.
    setPickedOperation(action.operation);
    focusComposer(action.prompt ?? '');
  }

  function createFromBriefing(result: BriefingResult): void {
    setBriefing(false);
    // O agente ainda não existe: as escolhas são aplicadas quando o id chegar.
    pendingInitiator.current = {
      initiator: result.initiator,
      name: result.name,
      suggestedRepliesEnabled: result.suggestedRepliesEnabled,
    };
    const payload = {
      scope: context.scope,
      ...(context.scopeId ? { scopeId: context.scopeId } : {}),
      operation: 'agent.create',
      ...(result.playbookKey ? { playbookKey: result.playbookKey } : {}),
    };
    lastSend.current = { content: result.message, options: payload };
    void send(result.message, payload);
  }

  function retry(): void {
    const pending = lastSend.current;
    if (!pending) return;
    void send(pending.content, pending.options);
  }

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const content = draft.trim();
    // Enviar no meio do upload mandaria a fala sem a imagem que a explica.
    if (!content || busy || attachments.uploading) return;

    const attachmentIds = attachments.readyIds;
    const enviados = attachments.items.flatMap((item) =>
      item.status === 'ready' && item.uploaded
        ? [{ id: item.uploaded.id, url: item.uploaded.url, fileName: item.uploaded.fileName }]
        : [],
    );
    const options = {
      scope: context.scope,
      ...(context.scopeId ? { scopeId: context.scopeId } : {}),
      // A ação da tela vai SEMPRE, como pista — tirá-la deixou o roteador sem
      // saber onde o usuário estava. `operationPicked` diz se foi escolha dele:
      // só aí vale anunciar que o S.O decidiu outra coisa.
      ...(operation ? { operation } : {}),
      ...(pickedOperation ? { operationPicked: true } : {}),
      ...(attachmentIds.length ? { attachmentIds, attachments: enviados } : {}),
    };
    lastSend.current = { content, options };
    setDraft('');
    attachments.clear();

    await send(content, options);
    setPickedOperation(null);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const images = imagesFromClipboard(event.clipboardData);
    if (images.length === 0) return;
    // Só bloqueia o padrão quando HÁ imagem: colar texto continua colando texto.
    event.preventDefault();
    void attachments.add(images);
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>): void {
    const images = imagesFromClipboard(event.dataTransfer);
    if (images.length === 0) return;
    event.preventDefault();
    void attachments.add(images);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter envia; Shift+Enter quebra linha — um briefing tem parágrafos.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
            <Sparkles aria-hidden className="size-[18px]" />
          </span>
          <span className="shrink-0 text-base font-semibold tracking-tight">MyAIHub</span>
          <SpendBadge />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <SoundToggle />
          {onToggleExpand && (
            <IconButton
              label={expanded ? 'Reduzir painel' : 'Alargar painel'}
              className="size-9"
              onClick={onToggleExpand}
            >
              <ChevronsLeftRight aria-hidden className="size-[18px]" />
            </IconButton>
          )}
          <IconButton label="Fechar painel" className="size-9" onClick={onClose ?? close}>
            <X aria-hidden className="size-[18px]" />
          </IconButton>
        </div>
      </div>

      <div ref={feed} className="min-h-0 flex-1 overflow-auto bg-canvas px-4 py-5">
        <div className="flex flex-col gap-6">
          {/* O estado abre o painel e permanece: é o cabeçalho do contexto, não
              uma mensagem que rola para fora da vista. */}
          <WorkspaceHeader workspace={workspace} onPickAction={pickAction} />

          {groupByContext(state.turns).map((grupo, indice) => (
            <section key={`${grupo.key}-${indice}`} className="flex flex-col gap-6">
              {/* ONDE aquelas perguntas foram feitas: o histórico é um só, e sem
                  o divisor a resposta de um contexto parece ser de outro. */}
              <ContextDivider label={grupo.label} />
              {grupo.turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  projectId={projectId}
                  onPickQuestion={focusComposer}
                />
              ))}
            </section>
          ))}

          {state.status !== 'idle' && (
            <TurnView
              turn={{
                request: state.request,
                attachments: state.attachments,
                understood: state.understood,
                operationLabel: state.operationLabel ?? '',
                answering: state.answering,
                answer: state.streamedText,
                notices: state.notices,
                questions: state.questions,
                entity: state.entity,
                costMicros: state.costMicros,
                totalTokens: state.totalTokens,
                trace: state.trace,
                status:
                  state.status === 'failed'
                    ? 'failed'
                    : state.status === 'completed'
                      ? 'completed'
                      : 'running',
              }}
              projectId={projectId}
              onPickQuestion={focusComposer}
              onRetry={lastSend.current ? retry : undefined}
            />
          )}

          {state.status !== 'running' && (
            <div className="flex flex-col gap-4">
              <QuickActions actions={actions} disabled={busy} onPick={pickAction} />
              {operation === 'agent.create' &&
                (briefing ? (
                  <AgentBriefing
                    disabled={busy}
                    onCancel={() => setBriefing(false)}
                    onReady={createFromBriefing}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setBriefing(true)}
                    className="rounded-[var(--radius-control)] border border-border px-3 py-2 text-left text-[13px] transition-colors hover:border-border-strong disabled:opacity-50"
                  >
                    <span className="block font-medium">Criar um agente</span>
                    <span className="mt-0.5 block text-[12px] text-text-muted">
                      Escolho as perguntas certas para o papel e configuro a partir das respostas.
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={submit}
        className={cx(
          'shrink-0 border-t border-border bg-surface px-3 pt-2.5 pb-3',
          briefing && 'hidden',
        )}
      >
        {/*
          O que vai rodar e QUEM vai responder ficam logo acima do campo, que é
          onde a escolha importa.

          O chip só aparece quando o usuário ESCOLHEU uma ação. Antes ele
          mostrava a primeira ação da tela ("ajustar estratégia") em todo envio,
          e o S.O — que escolhe sozinho pelo pedido — frequentemente fazia outra
          coisa: a tela anunciava uma operação e rodava outra.
        */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-subtle">
            {pickedOperation && OPERATION_LABELS[pickedOperation] ? (
              <>
                <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                  {OPERATION_LABELS[pickedOperation]}
                </span>
                <button
                  type="button"
                  onClick={() => setPickedOperation(null)}
                  className="hover:text-text"
                >
                  limpar
                </button>
              </>
            ) : null}
          </p>
          {/* Quem responde o painel é o papel `hub.reasoning`. */}
          <ModelPicker role="hub.reasoning" className="shrink-0" />
        </div>

        <div
          className={cx(
            'rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] transition-colors',
            'focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15',
            busy && 'opacity-70',
          )}
        >
          <div className="px-3 pt-3 empty:hidden">
            <AttachmentStrip items={attachments.items} onRemove={attachments.remove} />
            <AttachmentErrors items={attachments.items} />
          </div>

          <label htmlFor="hub-composer" className="sr-only">
            Falar com o MyAIHub
          </label>
          <textarea
            ref={composer}
            id="hub-composer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            rows={expanded ? 5 : 3}
            disabled={busy}
            placeholder={(pickedOperation && PLACEHOLDERS[pickedOperation]) ?? DEFAULT_PLACEHOLDER}
            className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-relaxed text-text outline-none placeholder:text-text-subtle"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              <input
                ref={filePicker}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(event) => {
                  void attachments.add(Array.from(event.target.files ?? []));
                  // Sem isto, escolher o MESMO arquivo duas vezes não dispara o
                  // evento na segunda.
                  event.target.value = '';
                }}
              />
              <IconButton
                label="Anexar imagem"
                disabled={attachments.full}
                onClick={() => filePicker.current?.click()}
              >
                <ImagePlus aria-hidden className="size-4" />
              </IconButton>
              <span className="truncate text-[11px] text-text-subtle">
                Enter envia · Shift+Enter quebra linha · cole um print
              </span>
            </div>
            {/*
              O spinner fica na MINIATURA, não aqui. Girar o botão enquanto a
              imagem sobe faz parecer que a mensagem já foi enviada.
            */}
            <Button
              type="submit"
              size="sm"
              loading={busy}
              disabled={!draft.trim() || busy || attachments.uploading}
              aria-label="Enviar"
              className="rounded-xl"
            >
              <Send aria-hidden className="size-3.5" />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
