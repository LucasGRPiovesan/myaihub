import {
  parseSpeech,
  type VisualBlock,
  type VisualBlockRow,
  type VisualIcon,
} from '@myaihub/shared';
import {
  Award,
  BarChart3,
  Box,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Factory,
  FileText,
  Handshake,
  Lightbulb,
  Package,
  Phone,
  Search,
  Settings,
  Shield,
  Star,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  Zap,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '../../design-system/primitives';
import { RichText } from '../hub/RichText';

/**
 * A FALA DO AGENTE COM OS COMPONENTES QUE ELA PEDE.
 *
 * O chat público renderizava tudo com `whitespace-pre-wrap`: uma lista de
 * etapas chegava como parágrafo com hífens, um comparativo como texto corrido.
 * Isto é o outro lado do `§VISUAL§` — o agente marca a forma do conteúdo e aqui
 * ela vira estrutura.
 *
 * ========== HERDA A MARCA, E É POR ISSO QUE NÃO TEM COR PRÓPRIA ==========
 *
 * Nenhum componente aqui escreve um HEX: tudo sai de tokens —
 * `--color-accent`, `--color-border`, `--color-surface`, `--color-success`,
 * `--color-danger` e `--radius-card`. Na página pública essas variáveis são as
 * da marca do cliente (ver `brandCssVariables`), então um comparativo dentro do
 * chat da Sankar sai azul-Sankar, com vantagem/desvantagem na cor que O CLIENTE
 * escolheu para sinalizar isso — nunca um verde/vermelho de biblioteca de UI.
 * A psicologia da cor entra pelo TOKEN, nunca por um valor fixo neste arquivo.
 *
 * ========== ESCRITO À MÃO, COMO O RichText ==========
 *
 * Mesma razão dele, com o risco um degrau acima: isto renderiza o que um modelo
 * escreveu para um visitante ANÔNIMO, numa página fora do portão de login.
 * Nada é interpretado como HTML, não existe `dangerouslySetInnerHTML` neste
 * arquivo, e cada célula é um nó de texto.
 *
 * ========== O ÍCONE É ESCOLHA DO MODELO, MAS DENTRO DE UM MAPA FECHADO ======
 *
 * `VISUAL_ICONS` (pacote compartilhado) é o vocabulário; este mapa é a ÚNICA
 * tradução dele para componente de verdade. Não existe resolução dinâmica de
 * nome de ícone — a mesma razão pela qual não existe HTML dinâmico aqui: um
 * nome livre seria decidir, a partir de texto de um modelo, qual código rodar.
 */
const ICON_MAP: Record<VisualIcon, LucideIcon> = {
  document: FileText,
  search: Search,
  settings: Settings,
  check: CheckCircle2,
  truck: Truck,
  shield: Shield,
  award: Award,
  clock: Clock,
  wrench: Wrench,
  target: Target,
  users: Users,
  phone: Phone,
  'trending-up': TrendingUp,
  package: Package,
  money: DollarSign,
  calendar: Calendar,
  star: Star,
  zap: Zap,
  alert: AlertTriangle,
  box: Box,
  factory: Factory,
  chart: BarChart3,
  handshake: Handshake,
  lightbulb: Lightbulb,
};

/**
 * Selo com o ícone escolhido — mesma forma em `passos`, `pontos`, `opcoes` e
 * `destaque`.
 *
 * `size-9`/`size-[18px]` (não `size-8`/`size-4`): testado com usuário real, o
 * selo menor lia como detalhe apagado, quase invisível ao lado do texto —
 * "nem ícones semânticos... estão aparecendo" era em parte isso: o ícone
 * existia, mas não tinha peso para ser notado.
 */
function IconBadge({ icon, className }: { icon: VisualIcon; className?: string }) {
  const Icon = ICON_MAP[icon];
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent',
        className ?? 'size-9',
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

/**
 * O título do componente usa a fonte de TÍTULO da marca, não a de corpo.
 *
 * É a única diferenciação tipográfica que este arquivo se permite — o resto do
 * texto é corpo. Duas fontes por componente, e não uma só, é o que faz um
 * comparativo parecer produzido em vez de digitado às pressas; mais que isso
 * (cor própria, ícone decorativo no título) seria o excesso que a referência
 * mostrada tinha e que o pedido foi explícito em evitar.
 */
function BlockFrame({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface',
        className,
      )}
    >
      {title && (
        <p
          className="border-b border-border px-3.5 py-2.5 text-[13px] font-semibold text-text"
          style={{ fontFamily: 'var(--font-heading, var(--font-sans))' }}
        >
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * Etapas em ordem — uma TIMELINE, não uma lista com número na frente.
 *
 * A primeira versão numerava cada linha, mas separava as linhas com borda
 * horizontal — o que lê como uma lista empilhada, não como um fluxo contínuo.
 * Testado com usuário real: "não diria que está errado, mas uma lista não
 * ordenada se associa mais a tópicos". A LINHA conectando os círculos é o que
 * faz o olho ler sequência em vez de itens soltos.
 *
 * O número vem do CÓDIGO (a posição), nunca do modelo — ele não tem como errar
 * a contagem. O ícone, quando o modelo escolheu um, substitui o número dentro
 * do círculo; sem ícone, o número sozinho já basta.
 */
function Passos({ block }: { block: VisualBlock }) {
  return (
    <BlockFrame title={block.title}>
      <ol className="flex flex-col p-4">
        {block.rows.map((row, index) => {
          const Icon = row.icon ? ICON_MAP[row.icon] : null;
          const ultimo = index === block.rows.length - 1;

          return (
            <li key={index} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-foreground"
                >
                  {Icon ? <Icon className="size-4" /> : index + 1}
                </span>
                {/* A LINHA que conecta os círculos — é ela que transforma uma
                    lista numerada num fluxo. Ausente no último item: uma linha
                    apontando para nada sugere que falta uma etapa. */}
                {!ultimo && <span aria-hidden className="w-px flex-1 bg-border" />}
              </div>
              <div className={cx('min-w-0', !ultimo ? 'pb-5' : 'pb-0.5')}>
                <p className="pt-1 text-[13px] font-semibold text-text">{row.cells[0]}</p>
                {row.cells[1] && (
                  <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                    {row.cells[1]}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </BlockFrame>
  );
}

type Sentiment = 'pro' | 'con' | null;

/**
 * Vantagem/desvantagem NUM VALOR, marcada com "+ " ou "- " no início.
 *
 * A convenção é do modelo (ver a instrução em `agent-prompt.ts`): o mesmo
 * critério pode ser "+ " numa opção e "- " noutra — psicologia da cor é sobre o
 * que aquele item específico REPRESENTA para quem decide, não uma propriedade
 * do critério inteiro. Sem marcação, o valor é neutro e não ganha cor nenhuma —
 * nem todo critério é favorável/desfavorável (ex.: "o que é", descritivo).
 */
function parseSentiment(value: string): { sign: Sentiment; text: string } {
  const pro = /^\s*\+\s*/.exec(value);
  if (pro) return { sign: 'pro', text: value.slice(pro[0].length) };
  const con = /^\s*-\s+/.exec(value);
  if (con) return { sign: 'con', text: value.slice(con[0].length) };
  return { sign: null, text: value };
}

/**
 * Quando só há DUAS opções e uma marcou o lado, a outra INFERE o oposto.
 *
 * Testado com usuário real, três formulações de instrução seguidas: o modelo
 * marca de bom grado o lado favorável e para por aí — a metade desfavorável
 * fica sem "- " mesmo pedindo explicitamente as duas. É a mesma lição que este
 * repositório já pagou noutro lugar: regra que sobrevive a três redações e
 * continua falhando não é problema de redação, é FORMA que precisa de garantia
 * estrutural, não de mais uma tentativa de prompt.
 *
 * A inferência só vale para DUAS opções — com três ou mais, "o oposto de +" não
 * tem resposta única, e inventar uma seria pior que deixar neutro.
 */
function inferirOposto(sinais: Sentiment[]): Sentiment[] {
  if (sinais.length !== 2) return sinais;
  const [a, b] = sinais;
  if (a && !b) return [a, a === 'pro' ? 'con' : 'pro'];
  if (b && !a) return [b === 'pro' ? 'con' : 'pro', b];
  return sinais;
}

/**
 * Comparativo — um CARTÃO por opção, nunca uma tabela larga.
 *
 * A primeira versão era uma tabela com rolagem horizontal: correta no
 * conteúdo, ruim no celular — texto comprimido numa coluna estreita, ou a tela
 * inteira rolando de lado. Testado num viewport de telefone: a orientação foi
 * "fugir da rolagem horizontal sempre que possível, e nem comprimir o texto".
 *
 * A solução não é uma tabela mais inteligente — é OUTRA forma: cada opção vira
 * um cartão, e cada critério dentro dele é um par rótulo/valor que quebra
 * linha livremente. Empilhados no celular, lado a lado a partir de `sm`. Nada
 * aqui precisa rolar, e nada precisa ser espremido para caber.
 *
 * ========== A COR VEM DA MARCA, NUNCA DE UM VERDE/VERMELHO FIXO =============
 *
 * `text-success`/`text-danger` resolvem para `--color-success`/`--color-danger`
 * — que na página pública são os declarados na IDENTIDADE do cliente
 * (`brandCssVariables`), não um verde/vermelho genérico de biblioteca de UI.
 * Um projeto que não declarou os dois usa o default neutro do próprio sistema,
 * nunca uma cor inventada aqui.
 */
function Comparativo({ block }: { block: VisualBlock }) {
  const [header, ...linhas] = block.rows;
  if (!header) return null;

  const opcoes = header.cells.slice(1);

  // Textos e sinais separados ANTES de renderizar: é o que permite inferir o
  // lado que o modelo deixou sem marca (ver `inferirOposto`).
  const linhasProcessadas = linhas.map((linha) => {
    const valores = opcoes.map((_, coluna) => parseSentiment(linha.cells[coluna + 1] ?? ''));
    const sinais = inferirOposto(valores.map((valor) => valor.sign));
    return { criterio: linha.cells[0], valores, sinais };
  });

  return (
    <BlockFrame title={block.title}>
      <div className="grid gap-px bg-border p-3.5 sm:grid-cols-2 sm:gap-3 sm:bg-transparent sm:p-3">
        {opcoes.map((opcao, colunaIndex) => (
          <div
            key={colunaIndex}
            className="flex flex-col gap-2.5 bg-surface p-3.5 sm:rounded-[var(--radius-control)] sm:border sm:border-border"
          >
            <p
              className="text-[13px] font-semibold text-text"
              style={{ fontFamily: 'var(--font-heading, var(--font-sans))' }}
            >
              {opcao}
            </p>
            <dl className="flex flex-col gap-2">
              {linhasProcessadas.map((linha, linhaIndex) => {
                const sign = linha.sinais[colunaIndex] ?? null;
                const text = linha.valores[colunaIndex]?.text ?? '';

                return (
                  <div key={linhaIndex} className="flex flex-col gap-0.5">
                    <dt className="text-[11px] text-text-subtle">{linha.criterio}</dt>
                    <dd
                      className={cx(
                        'flex items-start gap-1.5 text-[13px] leading-relaxed',
                        sign === 'pro' && 'text-success',
                        sign === 'con' && 'text-danger',
                        !sign && 'text-text',
                      )}
                    >
                      {sign === 'pro' && (
                        <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      )}
                      {sign === 'con' && (
                        <XCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      )}
                      <span>{text}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </BlockFrame>
  );
}

/** O selo de ícone, quando a linha escolheu um — cai fora silenciosamente sem ele. */
function RowIcon({ row }: { row: VisualBlockRow }) {
  return row.icon ? <IconBadge icon={row.icon} /> : null;
}

/**
 * Pontos — itens soltos, com peso de VALOR quando o agente escolhe um ícone.
 *
 * Sem ícone é uma lista discreta (marcador de bala). Com ícone — o caso de
 * diferencial, benefício, prova social — cada item vira uma placa: ícone num
 * quadrado, título em destaque, detalhe abaixo. Testado com usuário real: a
 * mesma pergunta ("qual o diferencial de vocês") pedia mais peso visual do que
 * uma lista de bolinhas — sem virar uma página de vendas dentro do balão.
 */
function Pontos({ block }: { block: VisualBlock }) {
  const comIcone = block.rows.some((row) => row.icon);

  return (
    <BlockFrame title={block.title}>
      <ul className={cx('flex flex-col gap-1.5', comIcone ? 'p-2.5' : 'p-1')}>
        {block.rows.map((row, index) => (
          <li
            key={index}
            className={cx(
              'flex items-start gap-3 rounded-[var(--radius-control)]',
              // Com ícone o item vira uma PLACA (fundo próprio); sem ícone
              // continua sendo lista discreta — a mesma distinção que a
              // psicologia visual pede: valor/diferencial pesa mais que item comum.
              comIcone ? 'bg-surface-sunken p-3' : 'p-2.5',
            )}
          >
            {comIcone ? (
              row.icon ? (
                <IconBadge icon={row.icon} className="size-9 bg-surface text-accent" />
              ) : (
                <span className="size-9 shrink-0" />
              )
            ) : (
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
            )}
            <div className="min-w-0 pt-0.5">
              <p className="text-[13px] font-semibold text-text">{row.cells[0]}</p>
              {row.cells[1] && (
                <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">{row.cells[1]}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </BlockFrame>
  );
}

/**
 * Cartões de escolha.
 *
 * Clicáveis quando quem renderiza sabe responder (`onChoose`) — no chat público
 * e no Lab. Sem isso eles continuam legíveis, só não clicam: é o que acontece
 * num transcrito arquivado, onde responder não faria sentido nenhum.
 */
function Opcoes({ block, onChoose }: { block: VisualBlock; onChoose?: (label: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {block.title && <p className="text-[13px] font-semibold text-text">{block.title}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {block.rows.map((row, index) => {
          const label = row.cells[0] ?? '';
          const detalhe = row.cells[1];

          const conteudo = (
            <>
              <RowIcon row={row} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text">{label}</p>
                {detalhe && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">{detalhe}</p>
                )}
              </div>
            </>
          );

          return onChoose ? (
            <button
              key={index}
              type="button"
              onClick={() => onChoose(label)}
              className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-border bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-accent hover:bg-accent-soft"
            >
              {conteudo}
            </button>
          ) : (
            <div
              key={index}
              className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-border bg-surface px-3.5 py-2.5"
            >
              {conteudo}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Ficha({ block }: { block: VisualBlock }) {
  return (
    <BlockFrame title={block.title}>
      <dl className="flex flex-col">
        {block.rows.map((row, index) => (
          <div
            key={index}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border px-3.5 py-2 last:border-b-0"
          >
            <dt className="text-[13px] text-text-muted">{row.cells[0]}</dt>
            <dd className="text-[13px] font-medium text-text">{row.cells[1] ?? ''}</dd>
          </div>
        ))}
      </dl>
    </BlockFrame>
  );
}

/** Um número e o que ele significa. Sem legenda, um número solto não informa nada. */
function Destaque({ block }: { block: VisualBlock }) {
  const row = block.rows[0];
  if (!row) return null;

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border-l-2 border-accent bg-accent-soft px-3.5 py-3">
      <RowIcon row={row} />
      <div className="flex items-baseline gap-3">
        <span className="text-xl font-semibold tabular-nums text-text">{row.cells[0]}</span>
        {row.cells[1] && <span className="text-[13px] text-text-muted">{row.cells[1]}</span>}
      </div>
    </div>
  );
}

function Block({ block, onChoose }: { block: VisualBlock; onChoose?: (label: string) => void }) {
  switch (block.kind) {
    case 'passos':
      return <Passos block={block} />;
    case 'comparativo':
      return <Comparativo block={block} />;
    case 'pontos':
      return <Pontos block={block} />;
    case 'opcoes':
      return <Opcoes block={block} {...(onChoose ? { onChoose } : {})} />;
    case 'ficha':
      return <Ficha block={block} />;
    case 'destaque':
      return <Destaque block={block} />;
  }
}

export function AgentSpeech({
  content,
  onChoose,
  className,
}: {
  content: string;
  /** Responder pelo cartão clicado. Ausente = os cartões só são lidos. */
  onChoose?: (label: string) => void;
  className?: string;
}) {
  const parts = parseSpeech(content);

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {parts.map((part, index) =>
        part.type === 'text' ? (
          <RichText key={index} text={part.text} className="text-sm" />
        ) : (
          <Block key={index} block={part.block} {...(onChoose ? { onChoose } : {})} />
        ),
      )}
    </div>
  );
}
