import { brandCssVariables, type CanonicalBrandIdentity } from '@myaihub/shared';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useParams } from 'react-router';
import { apiRequest } from '../../lib/api-client';
import { imagesFromClipboard } from '../hub/attachments';
import { useInlineImages } from '../agents/inline-images';
import { AgentSpeech } from '../agents/AgentSpeech';
import { useTypewriter } from '../agents/useTypewriter';
import { useBrandFont } from '../projects/brand-font';

/** Mesmo limite do backend (`PUBLIC_INLINE_IMAGE_LIMITS`) — só 1, é anônimo. */
const PUBLIC_IMAGE_LIMITS = { maxImages: 1, maxBytes: 5 * 1024 * 1024 };

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** `blob:` local — a imagem não é salva no servidor, some ao recarregar. */
  imagePreview?: string;
  /** Efêmeras — presente só quando o agente decidiu oferecer. */
  suggestedReplies?: string[];
}

/**
 * A fala do agente, revelada GRADUALMENTE — nunca de uma vez.
 *
 * A resposta já chega inteira do servidor; antes disto ela "brotava" na tela
 * num só quadro, sem a suavidade que qualquer chat de IA conhecido tem. É o
 * MESMO efeito do Lab (`useTypewriter`): duas implementações divergiriam no
 * primeiro ajuste de ritmo.
 *
 * `onGrow` mantém a rolagem grudada no fim ENQUANTO o texto ainda está se
 * formando — sem isso, o efeito library rodaria fora da vista sempre que a
 * resposta for mais alta que a tela, porque o scroll só reage a `turnos`
 * mudar, e aqui o turno já existe e só o conteúdo dele está crescendo.
 */
function AssistantTurn({
  content,
  suggestedReplies,
  onGrow,
  onChoose,
}: {
  content: string;
  suggestedReplies?: string[];
  onGrow: () => void;
  onChoose: (label: string) => void;
}) {
  const { shown, done } = useTypewriter(content);

  useLayoutEffect(() => {
    onGrow();
  }, [shown, onGrow]);

  return (
    <>
      <AgentSpeech content={shown} onChoose={onChoose} />
      {/*
        As sugestões só aparecem quando o texto termina de se formar — como no
        Lab. Mostrá-las antes seria oferecer um atalho para uma resposta que o
        visitante ainda não terminou de ler.
      */}
      {done && suggestedReplies && suggestedReplies.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {suggestedReplies.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChoose(suggestion)}
              className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[12px] text-text transition-colors hover:border-accent-hover"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

interface Vista {
  campaignName: string;
  agentName: string;
  agentOpens: boolean;
  /** A marca CONGELADA na publicação. Nula em campanha publicada antes da Fase 5. */
  brand: CanonicalBrandIdentity | null;
}

interface Resposta {
  sessionId: string;
  reply: string;
  suggestedReplies?: string[];
}

interface Transcrito {
  turns: Array<{ role: 'VISITOR' | 'AGENT'; content: string }>;
}

/**
 * Onde o ponteiro da conversa fica entre um carregamento e outro.
 *
 * `sessionStorage`, não `localStorage`: o problema a resolver é o F5 no meio
 * do atendimento, e a aba é o recorte certo para isso. Em `localStorage`, uma
 * conversa de semanas atrás ressuscitaria sozinha quando a pessoa voltasse ao
 * anúncio — retomar sem ela ter pedido é pior que começar limpo.
 *
 * A chave inclui o `publicId`: dois atendimentos diferentes na mesma aba não
 * podem compartilhar sessão.
 */
const chaveDaSessao = (publicId: string): string => `myaihub.chat.${publicId}`;

function lerSessao(publicId: string): string | null {
  try {
    return sessionStorage.getItem(chaveDaSessao(publicId));
  } catch {
    // Navegador com armazenamento bloqueado: a conversa segue funcionando,
    // só não sobrevive ao recarregamento. Melhor que uma tela quebrada.
    return null;
  }
}

function guardarSessao(publicId: string, sessionId: string): void {
  try {
    sessionStorage.setItem(chaveDaSessao(publicId), sessionId);
  } catch {
    /* idem */
  }
}

function esquecerSessao(publicId: string): void {
  try {
    sessionStorage.removeItem(chaveDaSessao(publicId));
  } catch {
    /* idem */
  }
}

/**
 * O Public Chat (§17 Fase 9).
 *
 * Esta é a única tela do produto que uma pessoa de fora vê, e ela não é o
 * painel: sem sidebar, sem shell administrativo, sem nada que sugira que há um
 * sistema por trás. Quem chega aqui veio de um anúncio e quer conversar.
 *
 * Mobile-first de verdade — a conversa ocupa a altura toda, o campo fica
 * fixo embaixo e a lista rola. Reaproveitar o layout do painel encolheria a
 * conversa para caber num shell que não serve para nada aqui.
 *
 * O histórico é DO SERVIDOR (Fase 8). Esta tela guarda apenas o `sessionId` e o
 * que precisa desenhar; quem sabe o que foi dito é o banco. Enquanto o
 * histórico vinha daqui, um recarregamento apagava o atendimento no meio — e o
 * servidor acreditava neste navegador sobre o que ele mesmo tinha respondido.
 *
 * A MARCA vem da publicação e pinta a página. Ler a configuração atual faria a
 * cor mudar embaixo de quem está conversando porque alguém editou noutra tela.
 */
export function PublicChatPage() {
  const { publicId } = useParams();
  const [vista, setVista] = useState<Vista | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [turnos, setTurnos] = useState<Turn[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  // Enquanto o transcrito não voltou, a abertura automática não pode
  // disparar: ela criaria uma segunda conversa por cima da que existe.
  const [restaurando, setRestaurando] = useState(true);

  const proximoId = useRef(1);
  const abriu = useRef(false);
  const fim = useRef<HTMLDivElement>(null);
  /**
   * Gruda no fim só enquanto o visitante está lá.
   *
   * "Sempre desce" sequestrava a rolagem: subir para reler uma resposta e a
   * próxima fala do agente puxava a tela de volta para baixo no meio da
   * leitura. Chat de verdade só volta ao fim se o leitor já estava perto dele.
   */
  const feed = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true);
  const imagens = useInlineImages(PUBLIC_IMAGE_LIMITS);
  // Revogados quando a aba fecha — a imagem não é salva, este `blob:` é a
  // única prova visual do anexo enquanto a conversa está na tela.
  const issuedPreviewUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of issuedPreviewUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!publicId) return;

    apiRequest<Vista>(`/api/public/${publicId}`)
      .then(setVista)
      .catch(() => setIndisponivel(true));
  }, [publicId]);

  // A conversa de volta, quando existe uma nesta aba.
  //
  // Persistir no servidor resolvia só metade: sem este caminho de volta, o
  // navegador recarregava e mostrava tela vazia enquanto o atendimento estava
  // inteiro no banco.
  useEffect(() => {
    if (!publicId) return;

    const guardada = lerSessao(publicId);
    if (!guardada) {
      setRestaurando(false);
      return;
    }

    apiRequest<Transcrito>(`/api/public/${publicId}/sessions/${guardada}`)
      .then((transcrito) => {
        setSessionId(guardada);
        setTurnos(
          transcrito.turns.map((turno) => ({
            id: proximoId.current++,
            role: turno.role === 'VISITOR' ? ('user' as const) : ('assistant' as const),
            content: turno.content,
          })),
        );
        // Já houve conversa: a abertura não se repete.
        if (transcrito.turns.length > 0) abriu.current = true;
      })
      .catch(() => {
        // Sessão que o servidor não reconhece mais (campanha republicada com
        // outro endereço, banco limpo): esquecer é melhor que insistir.
        esquecerSessao(publicId);
      })
      .finally(() => setRestaurando(false));
  }, [publicId]);

  // O agente abre a conversa quando a configuração PUBLICADA diz que é ele.
  // Guarda de execução única: o StrictMode monta duas vezes, e sem isto a
  // abertura sairia duplicada na frente de quem chegou.
  useEffect(() => {
    if (!publicId || !vista?.agentOpens || abriu.current || restaurando) return;
    abriu.current = true;

    setEnviando(true);
    apiRequest<Resposta>(`/api/public/${publicId}/opening`, { method: 'POST', body: {} })
      .then((resultado) => {
        setSessionId(resultado.sessionId);
        guardarSessao(publicId, resultado.sessionId);
        setTurnos([
          {
            id: proximoId.current++,
            role: 'assistant',
            content: resultado.reply,
            ...(resultado.suggestedReplies?.length
              ? { suggestedReplies: resultado.suggestedReplies }
              : {}),
          },
        ]);
      })
      .catch(() => setErro('Não foi possível iniciar a conversa. Tente recarregar a página.'))
      .finally(() => setEnviando(false));
  }, [publicId, vista?.agentOpens, restaurando]);

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

  const grudarNoFim = useCallback(() => {
    if (stickToBottom.current) {
      fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  useEffect(() => {
    grudarNoFim();
  }, [turnos, enviando, grudarNoFim]);

  /**
   * `override` é o texto de um chip de resposta recomendada — o clique se
   * comporta como se o visitante tivesse digitado e mandado aquilo, sem
   * mexer no que ele já estava escrevendo no campo.
   */
  async function enviar(eventOrOverride?: FormEvent | string): Promise<void> {
    const override = typeof eventOrOverride === 'string' ? eventOrOverride : undefined;
    if (typeof eventOrOverride !== 'string') eventOrOverride?.preventDefault();

    const message = (override ?? texto).trim();
    const anexos = imagens.payload;
    // Foto sem legenda é o caso mais comum de anexo — não exige texto.
    if ((!message && anexos.length === 0) || enviando || imagens.pending || !publicId) return;

    // Mandar uma fala é a intenção mais forte de ver o fim da conversa — o
    // visitante volta a "grudar" mesmo que tivesse subido para reler algo.
    stickToBottom.current = true;

    if (override === undefined) setTexto('');
    setErro(null);
    setEnviando(true);

    // Detach, não clear: o preview precisa sobreviver no balão que está
    // prestes a entrar na conversa.
    const detached = imagens.detach();
    const imagePreview = detached[0]?.previewUrl;
    if (imagePreview) issuedPreviewUrls.current.push(imagePreview);

    const meu: Turn = {
      id: proximoId.current++,
      role: 'user',
      content: message || '(imagem anexada)',
      ...(imagePreview ? { imagePreview } : {}),
    };
    setTurnos((atual) => [...atual, meu]);

    try {
      const resultado = await apiRequest<Resposta>(`/api/public/${publicId}/messages`, {
        method: 'POST',
        // Só o `sessionId`: o servidor lê do banco o que ele mesmo gravou.
        body: {
          message,
          ...(sessionId ? { sessionId } : {}),
          ...(anexos.length ? { images: anexos } : {}),
        },
      });

      setSessionId(resultado.sessionId);
      guardarSessao(publicId, resultado.sessionId);
      setTurnos((atual) => [
        ...atual,
        {
          id: proximoId.current++,
          role: 'assistant',
          content: resultado.reply,
          ...(resultado.suggestedReplies?.length
            ? { suggestedReplies: resultado.suggestedReplies }
            : {}),
        },
      ]);
    } catch (caught) {
      setErro(caught instanceof Error ? caught.message : 'Não foi possível enviar. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  function aoTeclar(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void enviar();
    }
  }

  const marca = vista?.brand ?? null;

  const temaDaMarca = useMemo(
    () => (marca ? (brandCssVariables(marca) as CSSProperties) : undefined),
    [marca],
  );

  /*
    A fonte da marca, carregada de verdade — no `index.html` não daria: a mesma
    build atende marcas diferentes, e qual carregar depende de QUAL campanha
    está sendo servida.

    Este hook e o `useMemo` acima ficam ANTES do `if (indisponivel)`: hook
    depois de `return` condicional quebra a ordem entre renderizações.
  */
  useBrandFont(marca);

  if (indisponivel) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-center text-sm text-text-muted">Este atendimento não está disponível.</p>
      </div>
    );
  }

  return (
    // `h-dvh overflow-hidden`, NUNCA `min-h-dvh`: sem altura TRAVADA aqui, o
    // `<main className="overflow-y-auto">` abaixo nunca fica com overflow
    // próprio — quem rola é a PÁGINA inteira (cabeçalho incluso), e o scroll
    // "gruda no fim só se o visitante já estava lá" não tinha como funcionar
    // porque o `<main>` nunca tinha um scrollTop de verdade para observar.
    /*
      A PÁGINA INTEIRA VESTE A MARCA, não só a faixa do topo.

      Antes, só o `<header>` recebia a cor: o balão do visitante saía com o
      acento do MyAIHub, os chips com a nossa borda, o fundo com o nosso cinza e
      tudo na nossa fonte. Quem clicava num anúncio da marca chegava numa página
      que parecia de outra empresa — que é o oposto do que esta tela existe para
      fazer.

      A correção não é pintar componente por componente: é redefinir as MESMAS
      variáveis de tema no escopo desta página. Todo componente daqui já lê
      `--color-accent`, `--color-surface`, `--font-sans` e `--radius-card`, e
      passa a ler os da marca sem saber disso — inclusive os componentes visuais
      que o agente monta no meio da conversa.
    */
    <div
      className="flex h-dvh flex-col overflow-hidden bg-surface-muted font-sans"
      style={temaDaMarca}
    >
      {/*
        As cores vêm DECLARADAS, não calculadas aqui: quem garante o contraste é
        o domínio, ao salvar — adivinhar por luminância no cliente erraria nos
        tons de meio, e o erro apareceria só para quem chegou pelo anúncio.
      */}
      <header
        className="shrink-0 border-b border-border px-4 py-3"
        style={
          marca
            ? { backgroundColor: marca.colors.primary, color: marca.colors.onPrimary }
            : undefined
        }
      >
        <p className="text-[15px] font-semibold tracking-tight">
          {marca?.displayName || vista?.agentName}
        </p>
        <p className="text-[13px] opacity-80">{marca?.tagline || vista?.campaignName}</p>
      </header>

      <main ref={feed} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {turnos.map((turno) =>
            turno.role === 'user' ? (
              <div key={turno.id} className="flex flex-col items-end gap-1.5">
                {turno.imagePreview && (
                  <img
                    src={turno.imagePreview}
                    alt="Imagem anexada"
                    className="max-h-48 max-w-[70%] rounded-2xl border border-border object-cover"
                  />
                )}
                {!(turno.imagePreview && turno.content === '(imagem anexada)') && (
                  <p className="max-w-[85%] rounded-2xl bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-accent-foreground">
                    {turno.content}
                  </p>
                )}
              </div>
            ) : (
              // Sem balão do lado do agente: a fala dele é o conteúdo da tela,
              // não uma mensagem dentro de uma caixa.
              <div key={turno.id}>
                {/*
                  A fala vem com ESTRUTURA quando ela tem estrutura: um fluxo de
                  etapas vira etapas, um comparativo vira tabela. Clicar num
                  cartão de escolha responde por quem clicou — é a mesma porta
                  das respostas recomendadas, com o conteúdo à vista.

                  E aparece GRADUALMENTE — nunca de uma vez.
                */}
                <AssistantTurn
                  content={turno.content}
                  onGrow={grudarNoFim}
                  onChoose={(label) => void enviar(label)}
                  // Respostas recomendadas: só no ÚLTIMO turno (uma sugestão
                  // antiga deixou de ser "o próximo passo" assim que a
                  // conversa andou), e nunca enquanto uma resposta nova está
                  // a caminho.
                  {...(!enviando && turno.id === turnos[turnos.length - 1]?.id
                    ? { suggestedReplies: turno.suggestedReplies }
                    : {})}
                />
              </div>
            ),
          )}

          {enviando && (
            <p className="flex items-center gap-2 text-[13px] text-text-subtle">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              escrevendo…
            </p>
          )}

          {erro && (
            <p role="alert" className="text-[13px] text-danger">
              {erro}
            </p>
          )}

          <div ref={fim} />
        </div>
      </main>

      <form
        onSubmit={(event) => void enviar(event)}
        className="shrink-0 border-t border-border bg-surface px-4 py-3"
      >
        <div className="mx-auto max-w-2xl">
          {imagens.items.length > 0 && (
            <ul className="mb-2 flex gap-2">
              {imagens.items.map((item) => (
                <li key={item.key} className="relative">
                  <img
                    src={item.previewUrl}
                    alt={item.fileName}
                    className={`size-14 rounded-[var(--radius-control)] border border-border object-cover ${
                      item.status === 'failed' ? 'opacity-40 ring-1 ring-danger' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => imagens.remove(item.key)}
                    aria-label={`Remover ${item.fileName}`}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-[var(--shadow-card)]"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                  {item.status === 'failed' && (
                    <p role="alert" className="mt-1 max-w-14 text-[10px] leading-tight text-danger">
                      {item.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <label htmlFor="public-chat-input" className="sr-only">
              Sua mensagem
            </label>
            <label
              className={`inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border border-border text-text-muted ${
                imagens.full ? 'pointer-events-none opacity-50' : ''
              }`}
              title="Anexar imagem"
            >
              <ImagePlus aria-hidden className="size-4" />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={imagens.full}
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) void imagens.add(files);
                }}
              />
            </label>
            <textarea
              id="public-chat-input"
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              onKeyDown={aoTeclar}
              onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                const files = imagesFromClipboard(event.clipboardData);
                if (files.length > 0) void imagens.add(files);
              }}
              rows={1}
              placeholder="Escreva sua mensagem…"
              className="min-h-11 flex-1 resize-none rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 text-sm outline-none focus-visible:border-accent"
            />
            <button
              type="submit"
              disabled={
                enviando ||
                imagens.pending ||
                (texto.trim().length === 0 && imagens.payload.length === 0)
              }
              aria-label="Enviar"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent text-accent-foreground disabled:opacity-50"
            >
              <Send aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      </form>

      {/* O rodapé legal é responsabilidade de quem publica — CNPJ, política e o
          aviso de que quem responde é uma IA. Só aparece quando existe. */}
      {marca?.legalFooter && (
        <footer className="shrink-0 border-t border-border bg-surface px-4 py-2.5">
          <p className="mx-auto max-w-2xl text-[11px] leading-relaxed text-text-subtle">
            {marca.legalFooter}
          </p>
        </footer>
      )}
    </div>
  );
}
