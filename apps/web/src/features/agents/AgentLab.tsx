import { FlaskConical, ImagePlus, RotateCcw, Send, TriangleAlert, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Badge } from '../../design-system/feedback';
import { Button, Card, cx } from '../../design-system/primitives';
import { imagesFromClipboard } from '../hub/attachments';
import { useHub } from '../hub/HubProvider';
import { costTitle, formatBrl } from '../usage/cost';
import { useSpend, useRefreshSpend } from '../usage/usage.api';
import { ModelPicker } from '../models/ModelPicker';
import {
  fetchAdherence,
  fetchConversation,
  useAgentOpening,
  useTestAgent,
  type AdherenceVerdict,
  type AgentTestResult,
} from './agents.api';
import { useInlineImages, type InlineImageAttachment } from './inline-images';
import { AgentSpeech } from './AgentSpeech';
import { useTypewriter } from './useTypewriter';

/** Mesmos limites do backend (`LAB_INLINE_IMAGE_LIMITS`) — falha cedo, no cliente. */
const LAB_IMAGE_LIMITS = { maxImages: 3, maxBytes: 6 * 1024 * 1024 };

/**
 * Miniaturas do que foi anexado ao PRÓXIMO turno.
 *
 * Igual ao `AttachmentStrip` do Hub, mas sem estado "enviando": a conversão em
 * base64 é local e quase instantânea — só existe "pronta" ou "falhou".
 */
function InlineImageStrip({
  items,
  onRemove,
}: {
  items: InlineImageAttachment[];
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
              item.status === 'failed' && 'opacity-40 ring-1 ring-danger',
            )}
          />
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={`Remover ${item.fileName}`}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-[var(--shadow-card)] hover:text-text"
          >
            <X aria-hidden className="size-3" />
          </button>
          {item.status === 'failed' && (
            <p role="alert" className="mt-1 max-w-16 text-[10px] leading-tight text-danger">
              {item.error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  result?: AgentTestResult;
  /**
   * `blob:` local do que foi anexado. A imagem em si não é salva no
   * servidor — este preview é a única prova visual do anexo, e só dura
   * enquanto a aba estiver aberta (some ao recarregar).
   */
  imagePreviews?: string[];
}

/** Intervalo entre perguntas pelo veredito. */
const ADHERENCE_POLL_MS = 600;
/**
 * Quanto tempo insistir antes de desistir.
 *
 * O papel `validation.fast` tem teto de 11s e não repete — passado isso não há
 * mais veredito para vir, e continuar perguntando seria bater numa porta que
 * ninguém vai abrir.
 */
const ADHERENCE_GIVE_UP_MS = 14_000;

/**
 * O SELO RESOLVE SOZINHO, depois que a fala já está na tela.
 *
 * A conferência de regras é uma segunda chamada ao provider e ela SEGURAVA a
 * resposta: medido no banco, mediana de ~1s do agente contra ~1,1s do auditor —
 * a espera dobrava por um dado acessório sobre um texto já pronto e já pago. E
 * quando o auditor travava, cobrava 8s a mais para no fim dizer "indisponível".
 *
 * Agora o turno volta com `CHECKING` e esta função pergunta pelo resultado.
 * Desistir vira `UNAVAILABLE`, nunca "cumpridas": não saber não é aprovar, e
 * confundir os dois é exatamente o que já pintou o selo verde sobre um
 * validador morto.
 */
function useAdherenceWatch(
  turns: Turn[],
  onVerdict: (turnId: string, verdict: AdherenceVerdict) => void,
): void {
  // O que já está sendo observado. Sem isto, cada render do transcrito abriria
  // um relógio novo para o mesmo turno.
  const watching = useRef(new Set<string>());

  useEffect(() => {
    const pendentes = turns
      .map((turn) => turn.result)
      .filter(
        (result): result is AgentTestResult =>
          result !== undefined &&
          result.adherence === 'CHECKING' &&
          !watching.current.has(result.turnId),
      );

    if (pendentes.length === 0) return;

    const controllers: AbortController[] = [];

    for (const result of pendentes) {
      watching.current.add(result.turnId);
      const controller = new AbortController();
      controllers.push(controller);

      void (async () => {
        const limite = Date.now() + ADHERENCE_GIVE_UP_MS;

        while (Date.now() < limite && !controller.signal.aborted) {
          try {
            const verdict = await fetchAdherence(
              result.sessionId,
              result.turnId,
              controller.signal,
            );
            if (verdict.status !== 'CHECKING') {
              onVerdict(result.turnId, verdict);
              return;
            }
          } catch {
            // Rede oscilou ou a tela saiu: nos dois casos o selo cai em
            // "indisponível" logo abaixo, que é a verdade.
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, ADHERENCE_POLL_MS));
        }

        if (!controller.signal.aborted) {
          onVerdict(result.turnId, { status: 'UNAVAILABLE', violations: [] });
        }
      })();
    }

    return () => {
      for (const controller of controllers) controller.abort();
    };
  }, [turns, onVerdict]);
}

/**
 * Internal Lab: conversar com o agente sem publicar nada (§17 Fase 8).
 *
 * Configurar sem testar é escrever no escuro. E o teste só vale se mostrar mais
 * que a resposta: o PROMPT que o agente recebeu e as regras determinísticas que
 * a resposta violou. Sem isso seria um chat — e o ponto não é ver o agente
 * falar, é entender por que ele falou aquilo.
 *
 * Por isso ele também PARECE um chat: texto surgindo aos poucos, rolagem que
 * nunca deixa o usuário perdido — mas só a fala do USUÁRIO vira balão. A
 * resposta do agente é texto corrido, como nos chats de IA que o usuário já
 * conhece: um balão em volta da resposta some visualmente do "conteúdo" para
 * virar "interface", e o que importa aqui é o texto. O rigor de mostrar o
 * prompt e as violações continua — só a moldura mudou.
 *
 * A conversa é EFÊMERA: vive no cliente e some ao sair. Persistir experimento
 * sujaria a métrica de conversa real, e o usuário testa dezenas de vezes até a
 * configuração ficar boa.
 */
export function AgentLab({
  agentId,
  campaignId,
  /**
   * O teste com o NEGÓCIO por trás, sem o recorte de uma campanha.
   *
   * É o meio-termo entre os dois testes que já existiam. Direto no agente não
   * há negócio nenhum e o usuário precisa escrever um cenário à mão; pela
   * campanha o recorte é estreito de propósito. Aqui ele confere o que o agente
   * SABE da empresa — que é onde mora quase tudo o que ele acabou de cadastrar.
   *
   * Ignorado quando há campanha: ela já diz a qual projeto pertence, e duas
   * respostas para "onde esta conversa acontece" não têm como ser desempatadas.
   */
  projectId,
  /** Ocupa a altura disponível, com a lista rolando. Usado na Visão Geral. */
  fill = false,
  /**
   * O agente abre a conversa sozinho ao montar.
   *
   * Só quando a configuração diz que a iniciativa é dele: prometer na tela que
   * ele puxa o assunto e depois exibir um campo vazio esperando o usuário é
   * contradizer a própria configuração.
   */
  autoOpen = false,
  /**
   * A versão da configuração salva, vinda de fora.
   *
   * O backend já usa a config MAIS RECENTE em toda mensagem nova — isso nunca
   * foi o problema. O problema é a CONVERSA JÁ EXIBIDA: ela mistura falas de
   * antes e depois de um ajuste do MyAIHub, e quem está testando não sabe mais
   * o que está avaliando. Comparar esta versão com a que a conversa começou
   * é o que permite avisar, em vez de deixar o usuário descobrir sozinho.
   */
  configVersion,
}: {
  agentId: string;
  campaignId?: string;
  projectId?: string;
  fill?: boolean;
  autoOpen?: boolean;
  configVersion?: number;
}) {
  const test = useTestAgent(agentId);
  const opening = useAgentOpening(agentId);
  // Campanha ou projeto: nos dois casos o negócio já está em volta e o cenário
  // escrito à mão perde a razão de existir.
  const hasContext = Boolean(campaignId ?? projectId);
  const { publishTestTranscript, working } = useHub();
  const { data: spend } = useSpend();
  const refreshSpend = useRefreshSpend();
  /**
   * Onde esta conversa acontece.
   *
   * Pela CAMPANHA isto já está resolvido: ela e o projeto dizem o negócio, o
   * público e o objetivo. Direto no agente não existe nada disso — sem um
   * cenário o teste media a imaginação do modelo em vez da configuração, e o
   * usuário lia como se fosse comportamento do agente.
   *
   * `null` = ainda não informado; a conversa nem começou.
   */
  const [scenario, setScenario] = useState<string | null>(hasContext ? '' : null);
  /**
   * O teste começa por um clique, não pela montagem da tela.
   *
   * A Visão Geral é a capa do agente: abrir com um formulário no meio dela
   * pediria trabalho a quem só veio conferir o estado. E se a iniciativa for
   * do agente, montar já disparando uma chamada ao modelo gastaria token por
   * uma visita.
   */
  const [started, setStarted] = useState(hasContext);
  const [turns, setTurns] = useState<Turn[]>([]);

  /*
    O veredito chega depois da fala, e substitui o dela naquele turno.

    `useCallback` porque ele entra nas dependências do observador: recriado a
    cada render, ele reabriria um relógio por render para o mesmo turno.
  */
  const aplicarVeredito = useCallback((turnId: string, verdict: AdherenceVerdict) => {
    setTurns((current) =>
      current.map((turn) =>
        turn.result?.turnId === turnId
          ? {
              ...turn,
              result: {
                ...turn.result,
                adherence: verdict.status,
                violations: verdict.violations,
              },
            }
          : turn,
      ),
    );
  }, []);

  useAdherenceWatch(turns, aplicarVeredito);
  const [draft, setDraft] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const images = useInlineImages(LAB_IMAGE_LIMITS);
  // Todo `blob:` que já apareceu num balão, para revogar quando a conversa
  // reinicia ou a tela fecha — a imagem não é salva, então isto é a única
  // referência que ainda existe depois do turno enviado.
  const issuedPreviewUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of issuedPreviewUrls.current) URL.revokeObjectURL(url);
    };
  }, []);
  const opened = useRef(false);
  /**
   * A conversa persistida deste teste (Fase 8).
   *
   * Vive num ref e não em estado: nada na tela depende dela para renderizar, e
   * um `setState` aqui provocaria um quadro a mais por turno sem mudar um pixel.
   */
  const sessionId = useRef<string | null>(null);
  /** Onde o ponteiro desta conversa é guardado. Resolvido junto da restauração. */
  const labKey = useRef<string>('');
  // Enquanto o transcrito não voltou, a abertura automática não pode
  // disparar: ela criaria uma segunda conversa por cima da que existe.
  const [restoring, setRestoring] = useState(true);
  const nextId = useRef(0);

  /**
   * Guarda o ponteiro da conversa para o próximo carregamento.
   *
   * Só o id: quem sabe o que foi dito é o servidor. Falha de armazenamento
   * não pode derrubar o turno — o pior caso é o teste não retomar.
   */
  const rememberSession = useCallback((id: string) => {
    sessionId.current = id;
    try {
      if (labKey.current) sessionStorage.setItem(labKey.current, id);
    } catch {
      /* armazenamento bloqueado */
    }
  }, []);

  const forgetSession = useCallback(() => {
    sessionId.current = null;
    try {
      if (labKey.current) sessionStorage.removeItem(labKey.current);
    } catch {
      /* idem */
    }
  }, []);

  /**
   * Rolagem presa ao fim — MAS só enquanto o usuário está lá.
   *
   * "Sempre desce" sequestrava a rolagem: subir para reler algo e a próxima
   * resposta do agente puxava a tela de volta para baixo no meio da leitura.
   * Chat de verdade só gruda no fim quando o leitor já estava perto dele.
   */
  const feed = useRef<HTMLUListElement>(null);
  const stickToBottom = useRef(true);
  const busy = test.isPending || opening.isPending;

  useEffect(() => {
    const node = feed.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      stickToBottom.current = distance < 80;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  // Identidade ESTÁVEL: os balões chamam isto a cada quadro da revelação, e uma
  // função recriada a cada tecla do composer disparava o efeito deles à toa.
  const pinToBottom = useCallback(() => {
    const node = feed.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, []);

  // Novo turno, indicador de "digitando" aparecendo ou sumindo: desce SE o
  // usuário já estava no fim. `useLayoutEffect` porque a rolagem precisa
  // acontecer ANTES da tela pintar — com `useEffect` o usuário via o salto.
  useLayoutEffect(() => {
    pinToBottom();
  }, [turns.length, busy]);

  /** Payload de contexto — campanha, projeto OU cenário, nunca dois deles. */
  function contextBody(text = scenario) {
    if (campaignId) return { campaignId };
    if (projectId) return { projectId };
    return text ? { scenario: text } : {};
  }

  function fireOpening(text = scenario): void {
    opening.mutate(contextBody(text), {
      onSuccess: (result) => {
        rememberSession(result.sessionId);
        // ACRESCENTA, nunca substitui: um reinício que mantém contexto já pôs
        // o aviso de "reiniciado" na lista antes de chamar isto, e a abertura
        // inicial encontra a lista vazia — os dois casos funcionam com a
        // mesma linha.
        setTurns((current) => [
          ...current,
          { id: nextId.current++, role: 'assistant', content: result.reply, result },
        ]);
      },
    });
  }

  // O OS precisa VER a conversa para corrigir o agente sem que o usuário
  // tenha que narrar o que aconteceu ou colar um print.
  useEffect(() => {
    publishTestTranscript(
      turns
        .filter((turn) => turn.role !== 'system')
        .map((turn) => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
    );
  }, [turns, publishTestTranscript]);

  // Sair da tela zera: o painel não pode mandar a conversa de um agente ao
  // falar de outro — mesmo motivo pelo qual trocar de escopo limpa o painel.
  useEffect(() => () => publishTestTranscript(null), [publishTestTranscript]);

  /**
   * A conversa de volta, quando existe uma para este recorte.
   *
   * A chave inclui agente, campanha e projeto: o mesmo agente testado pelo
   * projeto e pela campanha são conversas diferentes, e misturá-las mostraria
   * a fala de um contexto dentro do outro.
   *
   * `sessionStorage` e não `localStorage`: o que se resolve aqui é o F5 no
   * meio de um teste. Uma conversa de ontem ressuscitando sozinha ao abrir a
   * tela seria pior que começar limpo.
   */
  useEffect(() => {
    const chave = `myaihub.lab.${agentId}.${campaignId ?? ''}.${projectId ?? ''}`;

    let guardada: string | null = null;
    try {
      guardada = sessionStorage.getItem(chave);
    } catch {
      // Armazenamento bloqueado: o Lab funciona, só não retoma.
    }

    labKey.current = chave;

    if (!guardada) {
      setRestoring(false);
      return;
    }

    let ativo = true;

    fetchConversation(guardada)
      .then((conversa) => {
        if (!ativo) return;
        sessionId.current = conversa.id;
        if (conversa.scenario) setScenario(conversa.scenario);
        if (conversa.turns.length > 0) {
          opened.current = true;
          setStarted(true);
          setTurns(
            conversa.turns.map((turno) => ({
              id: nextId.current++,
              role: turno.role === 'VISITOR' ? ('user' as const) : ('assistant' as const),
              content: turno.content,
            })),
          );
        }
      })
      .catch(() => {
        // Conversa que o servidor não reconhece mais: esquecer é melhor que
        // insistir num id morto a cada turno.
        try {
          sessionStorage.removeItem(chave);
        } catch {
          /* idem */
        }
      })
      .finally(() => {
        if (ativo) setRestoring(false);
      });

    return () => {
      ativo = false;
    };
  }, [agentId, campaignId, projectId]);

  useEffect(() => {
    // Sem cenário a conversa não começa: abrir antes seria o agente falando
    // sem saber onde está — exatamente o que o cenário existe para evitar.
    if (!autoOpen || scenario === null || opened.current || restoring) return;
    // Guarda de execução ÚNICA, não dependência: o StrictMode monta duas vezes
    // em desenvolvimento, e sem isto o agente abriria a conversa em duplicata.
    opened.current = true;
    fireOpening();
  }, [autoOpen, scenario, restoring, fireOpening]);

  /**
   * A versão que ESTA conversa reflete.
   *
   * Começa junto da primeira versão recebida — sem isso, montar a tela já
   * reiniciaria uma conversa que ainda nem existe.
   */
  const syncedVersion = useRef<number | undefined>(configVersion);
  const [keepContext, setKeepContext] = useState(true);

  /**
   * O S.O calibrou este agente: o teste recarrega sozinho, UMA VEZ, no FIM.
   *
   * A primeira versão disto reagia à VERSÃO: toda vez que o número mudava, a
   * conversa reiniciava e o agente se apresentava de novo. Parecia certo até o
   * S.O passar a conferir o próprio trabalho — porque aí um único pedido do
   * usuário produz DUAS versões (a correção e a rodada de reforço), e cada uma
   * disparava uma saudação paga que ninguém leu:
   *
   *   ajuste → v31 → saudação → ensaio → reprovou → v32 → saudação → ensaio
   *
   * Duas saudações e duas auditorias por pedido, das quais metade era jogada
   * fora no instante seguinte. Agora o gatilho é o TRABALHO TERMINAR: enquanto
   * a operação corre a tela fica fechada (`CalibrationVeil`), e o reinício
   * acontece na transição para "acabou" — uma saudação por pedido, sempre com
   * a última versão.
   */
  const calibrando = working?.scope === 'AGENT' && working.scopeId === agentId;
  const estavaCalibrando = useRef(false);

  useEffect(() => {
    if (calibrando) {
      estavaCalibrando.current = true;
      return;
    }

    if (!estavaCalibrando.current) return;
    estavaCalibrando.current = false;

    if (configVersion === undefined) return;
    // Versão igual = o turno foi uma RESPOSTA, ou nada mudou de fato. Reiniciar
    // ali cobraria uma saudação para mostrar exatamente o que já estava na tela.
    if (configVersion === syncedVersion.current) return;

    const version = configVersion;
    syncedVersion.current = version;

    // Nada em tela para confundir: acompanha a versão nova em silêncio.
    if (turns.length === 0) return;

    restartConversation(true, 'calibration', version);
  }, [calibrando, configVersion]);

  // Fora de uma calibração, a versão que a conversa reflete acompanha a
  // realidade em silêncio — é o caso da edição manual pelo formulário.
  useEffect(() => {
    if (!calibrando && turns.length === 0) syncedVersion.current = configVersion;
  }, [calibrando, configVersion, turns.length]);

  const lastResult = [...turns].reverse().find((turn) => turn.result)?.result;
  const lastPrompt = lastResult?.systemPrompt;
  /**
   * Os trechos de conhecimento que entraram no ÚLTIMO turno.
   *
   * Ficam à mostra sem precisar abrir o prompt inteiro: a pergunta "de onde
   * ele tirou isso?" é a primeira que aparece quando o agente responde algo
   * específico, e o prompt inteiro é longo demais para responder a ela.
   */
  const lastKnowledge = lastResult?.knowledge ?? [];

  /**
   * A falha aparece DENTRO da conversa, com a mensagem que a API deu.
   *
   * "Não foi possível testar" numa linha vermelha ao pé da tela não diz se o
   * problema foi do agente, da rede ou do modelo — e a API sabe a diferença:
   * sobrecarga do provider tem mensagem própria e pede só uma nova tentativa.
   */
  const failed = test.error ?? opening.error;
  const failure =
    failed instanceof Error ? failed.message : failed ? 'Não foi possível testar.' : null;

  /**
   * O último envio, guardado para poder ser refeito.
   *
   * Falha de provider é transitória por definição — sobrecarga passa em
   * segundos. Sem isto, a saída do usuário era redigitar a própria mensagem, e
   * a de uma abertura automática que falhou era recarregar a tela.
   */
  const lastSend = useRef<Parameters<typeof test.mutate>[0] | null>(null);

  function send(payload: Parameters<typeof test.mutate>[0]): void {
    lastSend.current = payload;
    test.mutate(payload, {
      onSuccess: (result) => {
        // O turno custou: o acumulado do cabeçalho muda aqui.
        refreshSpend();
        rememberSession(result.sessionId);
        setTurns((current) => [
          ...current,
          { id: nextId.current++, role: 'assistant', content: result.reply, result },
        ]);
      },
    });
  }

  /**
   * `override` é o texto de um chip de resposta recomendada — o clique se
   * comporta como se o usuário tivesse digitado e mandado aquilo, mas SEM
   * mexer no que ele já estava escrevendo no composer.
   */
  function submit(eventOrOverride?: FormEvent | string): void {
    const override = typeof eventOrOverride === 'string' ? eventOrOverride : undefined;
    if (typeof eventOrOverride !== 'string') eventOrOverride?.preventDefault();

    const message = (override ?? draft).trim();
    const attachments = images.payload;
    // Foto sem legenda ("segue a peça") é o caso mais comum de anexo — não
    // exige texto, só que não esteja tudo vazio.
    if ((!message && attachments.length === 0) || test.isPending || images.pending) return;

    // Mandar uma fala é a intenção mais forte de ver o fim da conversa — o
    // usuário volta a "grudar" mesmo que tivesse subido para reler algo.
    stickToBottom.current = true;

    // Detach, não clear: a miniatura precisa aparecer no balão que está
    // prestes a entrar na lista, e `clear()` revogaria o `blob:` antes disso.
    const detached = images.detach();
    const imagePreviews = detached.map((item) => item.previewUrl);
    issuedPreviewUrls.current.push(...imagePreviews);

    // Sem corte de histórico: quem decide a janela é o servidor, que é quem
    // paga o contexto. O cliente mandava 20 turnos e a 21ª fala era recusada
    // por validação no meio de uma conversa que estava indo bem.
    setTurns((current) => [
      ...current,
      {
        id: nextId.current++,
        role: 'user',
        content: message || '(imagem anexada)',
        ...(imagePreviews.length ? { imagePreviews } : {}),
      },
    ]);
    if (override === undefined) setDraft('');

    send({
      message,
      ...(sessionId.current ? { sessionId: sessionId.current } : {}),
      ...(attachments.length ? { images: attachments } : {}),
      ...contextBody(),
    });
  }

  function retry(): void {
    const pending = lastSend.current;
    if (pending) {
      send(pending);
      return;
    }
    fireOpening();
  }

  /**
   * Reinício DE VERDADE: a sessão anterior é esquecida e a fala recomeça do
   * zero — nunca uma continuação disfarçada de reinício.
   *
   * "Manter contexto" não significa "continuar de onde parou": significa
   * manter o CENÁRIO (ou a campanha/projeto) e recomeçar A CONVERSA nele. Sem
   * isso, quem queria ver como o agente ABRE de novo — depois de um ajuste,
   * por exemplo — nunca conseguia: a conversa só engordava.
   *
   * `reason` decide a nota deixada no lugar das falas apagadas: quem chamou
   * manualmente já sabe o que fez; a recalibração automática precisa dizer
   * por quê o teste recomeçou sozinho.
   */
  function restartConversation(
    preserveScenario: boolean,
    reason: 'manual' | 'calibration',
    version?: number,
  ): void {
    // Conversa nova é SESSÃO nova: reaproveitar a anterior faria o agente
    // continuar de onde parou justamente quando o pedido foi para zerar.
    forgetSession();
    opened.current = false;

    // As falas somem daqui — os previews delas também podem ir.
    for (const url of issuedPreviewUrls.current) URL.revokeObjectURL(url);
    issuedPreviewUrls.current = [];

    const askScenarioAgain = !hasContext && !preserveScenario;
    const note = askScenarioAgain
      ? null
      : reason === 'calibration'
        ? `O agente foi calibrado — o teste recomeça na versão ${version}, com o mesmo contexto.`
        : 'Reiniciado — mesmo contexto.';
    setTurns(note ? [{ id: nextId.current++, role: 'system', content: note }] : []);

    // Trocar de cenário é a razão mais comum para reiniciar sem manter
    // contexto: o usuário quer ver o mesmo agente em outra situação.
    if (askScenarioAgain) {
      setScenario(null);
      setStarted(true);
      return;
    }

    opened.current = true;
    if (autoOpen) fireOpening();
  }

  /**
   * O reinício MANUAL — o controle fica sempre visível, não só depois de um
   * aviso automático.
   *
   * "Manter contexto" marcado reinicia a conversa DE VERDADE (falas somem,
   * sessão nova), só que no MESMO cenário — é o que permite ver como o
   * agente ABRE de novo, sem precisar redigitar a situação. Desmarcado, pede
   * o cenário de novo também: é para quando o usuário quer testar outra
   * situação, não a mesma de novo.
   */
  function performRestart(): void {
    restartConversation(keepContext, 'manual');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    // `h-full`, não só `min-h-0`: sem altura própria, o Card é um bloco comum
    // dentro do container que reserva o espaço — ele cresce com o conteúdo em
    // vez de ocupar o espaço reservado, e a lista interna nunca fica alta o
    // bastante para precisar da PRÓPRIA rolagem. O efeito visível era duplo:
    // a página inteira rolava (porque o transbordo saía do Card, não da `<ul>`)
    // e `pinToBottom` não tinha o que fazer (não havia posição de rolagem
    // interna para ajustar — o conteúdo simplesmente empurrava a página).
    <Card className={cx('flex flex-col p-5', fill ? 'h-full min-h-0' : 'mt-5')}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-text-subtle">
            <FlaskConical aria-hidden className="size-3.5" />
            Testar
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {campaignId
              ? 'Conversa com o contexto desta campanha carregado.'
              : projectId
                ? 'Conversa com o negócio deste projeto carregado. Não entra em métrica.'
                : 'Conversa só com o Agent Core. Não entra em métrica nem em publicação.'}
          </p>
          {!hasContext && scenario ? (
            // O cenário fica à vista durante a conversa inteira: sem isso o
            // usuário volta depois, lê a resposta e não lembra sob que premissa
            // ela foi dada.
            <p className="mt-2 line-clamp-2 rounded-[var(--radius-control)] bg-surface-sunken px-2.5 py-1.5 text-[12px] leading-relaxed text-text-muted">
              {scenario}
            </p>
          ) : null}
        </div>
        {started && (turns.length > 0 || scenario !== null) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {/*
              O mesmo acumulado do painel, no mesmo lugar visual: testar também
              gasta, e o Lab é onde se gasta com mais frequência — dezenas de
              turnos até a configuração ficar boa.
            */}
            {spend && spend.month.costMicros > 0 && (
              <span
                className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] tabular-nums text-text-muted"
                title={costTitle(spend.month.costMicros, spend.rate)}
              >
                {formatBrl(spend.month.costMicros, spend.rate)} no mês
              </span>
            )}
            {/*
              O checkbox decide o QUE "Reiniciar" faz — não some depois de um
              clique, porque é o mesmo controle que serve para recomeçar no
              mesmo cenário (marcado) e para trocar de cenário (desmarcado), e
              o usuário alterna entre os dois casos na mesma sessão.
            */}
            <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <input
                type="checkbox"
                checked={keepContext}
                onChange={(event) => setKeepContext(event.target.checked)}
                className="size-3.5 rounded border-border accent-accent"
              />
              Manter contexto
            </label>
            <Button size="sm" variant="ghost" onClick={performRestart}>
              <RotateCcw aria-hidden className="size-3.5" />
              Reiniciar
            </Button>
          </div>
        )}
      </div>

      {!started && (
        <div className={cx('mt-4 flex flex-col', fill && 'min-h-0 flex-1 justify-center')}>
          <p className="max-w-md text-[13px] leading-relaxed text-text-muted">
            Converse com ele como se fosse o cliente. Você descreve a situação, ele responde com a
            configuração atual — e você vê o prompt que ele recebeu.
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={() => setStarted(true)}>
              <FlaskConical aria-hidden className="size-3.5" />
              Testar agente
            </Button>
          </div>
        </div>
      )}

      {started && scenario === null && (
        <ScenarioForm fill={fill} onReady={(text) => setScenario(text)} />
      )}

      {scenario !== null && (turns.length > 0 || busy || failure !== null) && (
        <ul
          ref={feed}
          className={cx(
            'mt-4 flex flex-col gap-3',
            fill && 'min-h-0 flex-1 overflow-auto scroll-smooth pr-1',
          )}
        >
          {turns.map((turn) => {
            if (turn.role === 'system') {
              return <SystemDivider key={turn.id} text={turn.content} />;
            }
            return turn.role === 'user' ? (
              <li key={turn.id} className="chat-in flex flex-col items-end gap-1.5">
                {turn.imagePreviews?.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt="Imagem anexada"
                    className="max-h-48 max-w-[70%] rounded-2xl border border-border object-cover"
                  />
                ))}
                {/* Placeholder de foto sem legenda não precisa de bolha própria
                    — a imagem já diz que algo foi mandado. */}
                {!(turn.imagePreviews?.length && turn.content === '(imagem anexada)') && (
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-text-inverted">
                    {turn.content}
                  </p>
                )}
              </li>
            ) : (
              <AssistantMessage
                key={turn.id}
                turn={turn}
                onGrow={pinToBottom}
                isLast={turn.id === turns[turns.length - 1]?.id}
                onSuggestion={submit}
              />
            );
          })}

          {busy && (
            <li className="chat-in flex justify-start">
              <TypingIndicator />
            </li>
          )}

          {failure !== null && !busy && (
            <li className="chat-in flex justify-start">
              <div
                role="alert"
                className="max-w-[85%] rounded-2xl rounded-bl-md border border-danger bg-danger-soft px-3.5 py-2 text-[13px] text-danger"
              >
                <p>{failure}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-1.5 font-medium underline underline-offset-2"
                >
                  Tentar de novo
                </button>
              </div>
            </li>
          )}
        </ul>
      )}

      {fill && scenario !== null && turns.length === 0 && !busy && failure === null && (
        <div className="flex min-h-0 flex-1 items-center justify-center py-10">
          <p className="max-w-sm text-center text-[13px] leading-relaxed text-text-muted">
            Fale como se fosse o cliente. A conversa fica guardada para você retomar, fora de
            qualquer relatório, e não afeta nenhuma publicação.
          </p>
        </div>
      )}

      <form onSubmit={submit} className={cx('mt-4 shrink-0', scenario === null && 'hidden')}>
        {/*
          QUEM vai responder, logo acima do campo — no momento em que a escolha
          importa. No cabeçalho ela ficava longe da fala que ela afeta.
          Quem fala no Lab é o papel `agent.runtime`.
        */}
        <div className="mb-2 flex justify-end">
          <ModelPicker role="agent.runtime" />
        </div>

        <label htmlFor="lab-composer" className="sr-only">
          Falar com o agente
        </label>
        <InlineImageStrip items={images.items} onRemove={images.remove} />
        <textarea
          ref={composer}
          id="lab-composer"
          value={draft}
          rows={2}
          disabled={busy}
          placeholder="Escreva como se fosse o cliente… ou cole/anexe uma foto"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
            const files = imagesFromClipboard(event.clipboardData);
            if (files.length > 0) void images.add(files);
          }}
          className={cx(
            'w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface',
            'px-3 py-2 text-sm text-text placeholder:text-text-subtle',
            'focus:border-border-strong disabled:opacity-60',
          )}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label
              className={cx(
                'inline-flex size-8 cursor-pointer items-center justify-center rounded-[var(--radius-control)]',
                'border border-border text-text-muted hover:border-border-strong hover:text-text',
                (busy || images.full) && 'pointer-events-none opacity-50',
              )}
              title="Anexar imagem"
            >
              <ImagePlus aria-hidden className="size-4" />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                disabled={busy || images.full}
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) void images.add(files);
                }}
              />
            </label>
            {lastPrompt ? (
              <button
                type="button"
                onClick={() => setShowPrompt((value) => !value)}
                className="text-xs text-text-subtle hover:text-text"
              >
                {showPrompt ? 'Ocultar' : 'Ver'} o prompt que ele recebeu
              </button>
            ) : (
              <span className="text-xs text-text-subtle">Enter envia</span>
            )}
          </div>
          <Button
            type="submit"
            size="sm"
            loading={test.isPending}
            disabled={busy || images.pending || (!draft.trim() && images.payload.length === 0)}
          >
            <Send aria-hidden className="size-3.5" />
            Enviar
          </Button>
        </div>
      </form>

      {lastKnowledge.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-control)] border border-border p-3">
          <p className="text-[11px] font-medium text-text-subtle">
            Conhecimento consultado neste turno
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {lastKnowledge.map((reference) => (
              <li key={`${reference.revisionId}-${reference.excerpt.slice(0, 24)}`}>
                <p className="text-[12px] font-medium text-text">{reference.title}</p>
                <p className="mt-0.5 line-clamp-3 text-[12px] leading-relaxed text-text-muted">
                  {reference.excerpt}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showPrompt && lastPrompt && (
        // Mostrar o prompt é o que separa um laboratório de um chat: o usuário
        // vê o que a configuração dele virou de fato.
        <pre className="mt-3 max-h-80 overflow-auto rounded-[var(--radius-control)] bg-surface-sunken p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-text-muted">
          {lastPrompt}
        </pre>
      )}
    </Card>
  );
}

/**
 * A fala do agente — texto corrido, SEM balão.
 *
 * Só a fala do usuário vira balão (§ Lab). A do agente é o conteúdo que o
 * usuário veio ler; uma caixa em volta dela é moldura competindo com o que
 * importa, e nenhum chat de IA que o usuário usa no dia a dia faz isso.
 *
 * O tamanho do texto cresce junto da revelação — e por isso avisa o pai
 * (`onGrow`) a cada quadro, para a rolagem continuar presa ao fim mesmo com o
 * conteúdo ainda se formando.
 */
function AssistantMessage({
  turn,
  onGrow,
  isLast,
  onSuggestion,
}: {
  turn: Turn;
  onGrow: () => void;
  /** Chips só no ÚLTIMO turno — sugestão de um turno antigo não é mais o "próximo passo". */
  isLast: boolean;
  onSuggestion: (text: string) => void;
}) {
  const { shown, done } = useTypewriter(turn.content);
  const { data: spend } = useSpend();
  const rate = spend?.rate;

  useLayoutEffect(() => {
    onGrow();
  }, [shown, onGrow]);

  return (
    <li className="chat-in flex justify-start">
      <div className="max-w-[92%] text-sm text-text">
        {/*
          O MESMO renderizador do chat público: testar o agente tem que mostrar
          o que o cliente vai ver. Com dois renderizadores, o comparativo
          apareceria só em produção — depois de publicado.
        */}
        <AgentSpeech content={shown} />

        {done && turn.result && turn.result.violations.length > 0 && (
          // O selo "verificada em código" só é verdade se alguém rodar o
          // checker. É aqui que ele roda, e é aqui que a violação aparece.
          <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            {turn.result.violations.map((violation) => (
              <li
                key={violation.check}
                className="flex items-start gap-1.5 text-[11px] text-danger"
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span>{violation.message}</span>
              </li>
            ))}
          </ul>
        )}

        {done && turn.result && (
          <p
            className="chat-in mt-2 flex items-center gap-2 text-[11px] tabular-nums text-text-subtle"
            title={costTitle(turn.result.costMicros, rate)}
          >
            {turn.result.totalTokens.toLocaleString('pt-BR')} tokens ·{' '}
            {formatBrl(turn.result.costMicros, rate)}
            {/*
              Sem violação NÃO é sinônimo de aprovado: o validador semântico
              pode simplesmente não ter respondido, e o selo verde ali afirmaria
              uma verificação que não aconteceu. "Verificada em código" só vale
              quando alguém verificou.
            */}
            {turn.result.violations.length === 0 && turn.result.adherence === 'CHECKED' && (
              <Badge tone="success">regras cumpridas</Badge>
            )}
            {turn.result.violations.length === 0 && turn.result.adherence === 'UNAVAILABLE' && (
              <Badge tone="warning">checagem indisponível</Badge>
            )}
            {/*
              A fala já está na tela; a conferência ainda corre. Dizer isso é o
              que permite entregar a resposta na hora sem fingir que ela foi
              aprovada — antes, o usuário esperava o auditor para ler o texto.
            */}
            {turn.result.adherence === 'CHECKING' && (
              <Badge tone="neutral">conferindo regras…</Badge>
            )}
          </p>
        )}

        {/*
          Respostas recomendadas: o agente decidiu que fazia sentido oferecer
          — clicar se comporta como se o interlocutor tivesse digitado e
          mandado aquilo. Só no turno mais recente: sugestão de uma resposta
          antiga deixou de ser "o próximo passo" assim que a conversa andou.
        */}
        {done &&
          isLast &&
          turn.result?.suggestedReplies &&
          turn.result.suggestedReplies.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {turn.result.suggestedReplies.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSuggestion(suggestion)}
                  className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[12px] text-text transition-colors hover:border-accent-hover"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
      </div>
    </li>
  );
}

/** Marca onde uma versão nova do agente passou a valer, em linha na conversa. */
function SystemDivider({ text }: { text: string }) {
  return (
    <li className="chat-in flex items-center gap-2 py-1" role="status">
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0 text-[11px] text-text-subtle">{text}</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

/** "…" animado enquanto o agente processa — o mesmo ritmo do indicador do WhatsApp. */
function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label="O agente está digitando"
      className="flex items-center gap-1 px-0.5 py-3"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="typing-dot size-1.5 rounded-full bg-text-subtle"
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </div>
  );
}

/**
 * Onde esta conversa acontece.
 *
 * Pedir antes de começar, e não durante, é o que separa um teste de um chat:
 * o agente precisa saber o negócio, o canal e quem é a pessoa do outro lado
 * para que a resposta signifique alguma coisa. Sem isso ele preenche as
 * lacunas por conta própria e o usuário atribui à configuração o que na
 * verdade o modelo inventou.
 *
 * Pela campanha isto nunca aparece: ela e o projeto já respondem tudo.
 */
function ScenarioForm({ fill, onReady }: { fill: boolean; onReady: (text: string) => void }) {
  const [text, setText] = useState('');
  const ready = text.trim().length >= 10;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onReady(text.trim());
      }}
      className={cx('chat-in mt-4 flex flex-col', fill && 'min-h-0 flex-1 justify-center')}
    >
      <label htmlFor="lab-scenario" className="text-[13px] font-medium">
        Antes de começar: onde esta conversa acontece?
      </label>
      <p className="mt-1 text-[12px] leading-relaxed text-text-subtle">
        Que negócio ele representa, por qual canal, e quem é a pessoa do outro lado. É o que a
        campanha diria por ele — aqui não existe campanha, e sem isso o agente inventa.
      </p>
      <textarea
        id="lab-scenario"
        rows={4}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (ready) onReady(text.trim());
          }
        }}
        placeholder={
          'Ex.: clínica odontológica em Curitiba. A pessoa chegou pelo WhatsApp\ndepois de ver um anúncio de clareamento e ainda não é cliente.'
        }
        className={cx(
          'mt-3 w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface',
          'px-3 py-2 text-sm text-text placeholder:text-text-subtle focus:border-border-strong',
        )}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-text-subtle">Enter começa</span>
        <Button type="submit" size="sm" disabled={!ready}>
          Começar
        </Button>
      </div>
    </form>
  );
}
