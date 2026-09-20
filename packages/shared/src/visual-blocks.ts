/**
 * OS COMPONENTES VISUAIS QUE O AGENTE MONTA NO MEIO DA CONVERSA.
 *
 * O chat nunca foi só texto: quando alguém pergunta "como funciona", a resposta
 * certa é um fluxo de etapas; quando precisa escolher entre duas linhas de
 * produto, é uma tabela; quando o agente vai resumir o que já coletou, é uma
 * ficha. Entregar tudo isso como parágrafo devolve ao visitante o trabalho de
 * reconstruir a estrutura que o agente já tinha na cabeça — e é justamente na
 * hora de decidir que ele mais precisa dela pronta.
 *
 * ========== POR QUE UM MARCADOR NO TEXTO, E NÃO SAÍDA ESTRUTURADA ==========
 *
 * `agent.runtime` fala por `generate()` — texto puro. Trocar para saída
 * estruturada, ou fazer uma segunda chamada para "decidir o componente",
 * dobraria a espera de todo turno de conversa, que é o número que o visitante
 * mais sente. É a mesma escolha que as respostas recomendadas já fizeram: o
 * modelo anexa um sinal reconhecível DENTRO da fala que ele ia escrever de
 * qualquer jeito, e custo marginal é zero.
 *
 * UM marcador com um TIPO, e não seis marcadores: cada símbolo novo na
 * instrução disputa atenção com o resto, e um parser só é um comportamento só.
 *
 * ========== POR QUE O BLOCO FICA NO TEXTO PERSISTIDO ==========
 *
 * Ao contrário da sugestão de resposta — que é um botão, não fala —, o conteúdo
 * do bloco É o que o visitante lê. Ele fica no texto salvo por duas razões, e a
 * segunda é a que não se negocia:
 *
 * 1. recarregar a página restaura a conversa inteira, com os blocos. Um fluxo
 *    que some no F5 deixa para trás um texto que se refere a ele;
 * 2. as regras determinísticas e a auditoria semântica leem a fala salva. Se o
 *    bloco fosse retirado antes delas, bastaria o agente pôr "entrega em 3
 *    dias" dentro de uma célula para escapar de uma regra que proíbe prometer
 *    prazo. O que o visitante lê é o que o sistema confere.
 */

export const VISUAL_BLOCK_MARKER = '§VISUAL§';
export const VISUAL_BLOCK_END = '§FIM§';

export const VISUAL_BLOCK_KINDS = [
  'passos',
  'comparativo',
  'pontos',
  'opcoes',
  'ficha',
  'destaque',
] as const;

export type VisualBlockKind = (typeof VISUAL_BLOCK_KINDS)[number];

/**
 * O ícone é SEMÂNTICO, escolhido pelo agente — mas dentro de um vocabulário
 * FECHADO, nunca um nome livre.
 *
 * Um nome livre significaria resolver dinamicamente qual componente renderizar
 * a partir de texto que um modelo escreveu — a mesma classe de risco que
 * `RichText` e `AgentSpeech` já recusam (nada de HTML dinâmico, nada de
 * `dangerouslySetInnerHTML`). Com o vocabulário fechado, "escolher o ícone" é
 * escolher uma CHAVE de um mapa que o nosso código já tem: o pior que um nome
 * inválido faz é a linha ficar sem ícone.
 *
 * A lista cobre o vocabulário de uma conversa comercial/operacional — processo,
 * confiança, tempo, gente, dinheiro — sem crescer a ponto de o modelo confundir
 * uma opção com outra.
 */
export const VISUAL_ICONS = [
  'document',
  'search',
  'settings',
  'check',
  'truck',
  'shield',
  'award',
  'clock',
  'wrench',
  'target',
  'users',
  'phone',
  'trending-up',
  'package',
  'money',
  'calendar',
  'star',
  'zap',
  'alert',
  'box',
  'factory',
  'chart',
  'handshake',
  'lightbulb',
] as const;

export type VisualIcon = (typeof VISUAL_ICONS)[number];

function isVisualIcon(value: string): value is VisualIcon {
  return (VISUAL_ICONS as readonly string[]).includes(value);
}

/**
 * Os componentes em que um ícone por linha faz sentido.
 *
 * `ficha` é par rótulo/valor — dado, não narrativa — e `comparativo` é tabela:
 * um ícone por critério competiria com as colunas em vez de ajudar a ler.
 */
const ICON_AWARE_KINDS = new Set<VisualBlockKind>(['passos', 'pontos', 'opcoes', 'destaque']);

/** Uma linha do bloco, já separada pelos `|` que o modelo escreveu. */
export interface VisualBlockRow {
  cells: string[];
  /** Ausente quando o modelo não escolheu um, ou escolheu um fora do vocabulário. */
  icon?: VisualIcon;
}

export interface VisualBlock {
  kind: VisualBlockKind;
  /** Vazio quando o modelo não deu título — nem todo bloco precisa de um. */
  title: string;
  rows: VisualBlockRow[];
}

/** Um pedaço da fala: ou texto corrido, ou um componente. */
export type SpeechPart = { type: 'text'; text: string } | { type: 'block'; block: VisualBlock };

const MAX_BLOCKS = 4;
const MAX_ROWS = 12;
const MAX_CELLS = 5;
const MAX_CELL_LENGTH = 200;

function isKind(value: string): value is VisualBlockKind {
  return (VISUAL_BLOCK_KINDS as readonly string[]).includes(value);
}

function parseBody(kind: VisualBlockKind, body: string[]): VisualBlock | null {
  let title = '';
  const rows: VisualBlockRow[] = [];

  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;

    const titulo = /^t[ií]tulo\s*:\s*(.+)$/i.exec(line);
    if (titulo && !title) {
      title = titulo[1]!.trim().slice(0, MAX_CELL_LENGTH);
      continue;
    }

    if (rows.length >= MAX_ROWS) break;

    const cells = line
      // Tabela em markdown chega com as bordas; o resto vem sem elas.
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim().replace(/^[-*·]\s*/, ''))
      .map((cell) => cell.slice(0, MAX_CELL_LENGTH))
      .slice(0, MAX_CELLS);

    // A linha `|---|---|` separa cabeçalho de corpo numa tabela: ela não é dado.
    if (cells.every((cell) => cell === '' || /^:?-+:?$/.test(cell))) continue;
    if (cells.every((cell) => cell === '')) continue;

    // O ÍCONE, quando o componente aceita um, vem na PRIMEIRA célula — e só
    // conta como ícone se bater com o vocabulário fechado. Do contrário, a
    // célula é conteúdo normal (linha sem ícone), nunca um valor descartado.
    let icon: VisualIcon | undefined;
    if (ICON_AWARE_KINDS.has(kind) && cells.length > 1) {
      const candidato = cells[0]!.trim().toLowerCase();
      if (isVisualIcon(candidato)) {
        icon = candidato;
        cells.shift();
      }
    }

    rows.push(icon ? { cells, icon } : { cells });
  }

  // Bloco sem linha nenhuma é ruído do modelo: renderizar uma moldura vazia é
  // pior que não renderizar nada.
  return rows.length > 0 ? { kind, title, rows } : null;
}

/**
 * Separa a fala em texto e componentes, preservando a ORDEM.
 *
 * A ordem importa: o agente escreve uma frase, mostra o fluxo e comenta o que
 * vem depois. Devolver os blocos numa lista à parte obrigaria o renderizador a
 * chutar onde encaixá-los.
 *
 * Bloco malformado não derruba a fala — o texto dele volta como texto. Um
 * marcador sem fim, num stream cortado no meio, é o caso normal disto.
 */
export function parseSpeech(content: string): SpeechPart[] {
  const limpo = hideTrailingPartialMarker(content);

  if (!limpo.includes(VISUAL_BLOCK_MARKER)) {
    const texto = limpo.trim();
    return texto ? [{ type: 'text', text: texto }] : [];
  }

  return parseParts(limpo);
}

/**
 * Esconde um marcador que ainda está chegando.
 *
 * O Lab revela a fala letra a letra. Sem isto, o visitante lê `§VISU` na tela
 * por uma fração de segundo antes de o marcador se completar — um símbolo
 * interno vazando para quem nunca deveria saber que ele existe. A mesma regra
 * serve a qualquer leitura parcial de um texto que ainda está sendo escrito.
 */
function hideTrailingPartialMarker(content: string): string {
  const ultimaQuebra = content.lastIndexOf('\n');
  const ultimaLinha = content.slice(ultimaQuebra + 1);

  const parcial =
    ultimaLinha.length > 0 &&
    ultimaLinha.length < VISUAL_BLOCK_MARKER.length &&
    VISUAL_BLOCK_MARKER.startsWith(ultimaLinha);

  return parcial ? content.slice(0, ultimaQuebra + 1) : content;
}

function parseParts(content: string): SpeechPart[] {
  const parts: SpeechPart[] = [];
  const linhas = content.replace(/\r\n/g, '\n').split('\n');

  let buffer: string[] = [];
  let blocos = 0;

  const despejarTexto = (): void => {
    const texto = buffer.join('\n').trim();
    if (texto) parts.push({ type: 'text', text: texto });
    buffer = [];
  };

  for (let index = 0; index < linhas.length; index += 1) {
    const linha = linhas[index] ?? '';
    const abertura = linha.trim().startsWith(VISUAL_BLOCK_MARKER);

    if (!abertura) {
      buffer.push(linha);
      continue;
    }

    const tipo = linha.trim().slice(VISUAL_BLOCK_MARKER.length).trim().toLowerCase();

    // Junta o corpo até o fim do bloco. Sem `§FIM§`, vai até o fim da fala:
    // é o que faz um stream interrompido ainda mostrar o que chegou.
    const corpo: string[] = [];
    let cursor = index + 1;
    while (cursor < linhas.length && !(linhas[cursor] ?? '').trim().startsWith(VISUAL_BLOCK_END)) {
      corpo.push(linhas[cursor] ?? '');
      cursor += 1;
    }

    const bloco = isKind(tipo) && blocos < MAX_BLOCKS ? parseBody(tipo, corpo) : null;

    if (bloco) {
      despejarTexto();
      parts.push({ type: 'block', block: bloco });
      blocos += 1;
    } else {
      // Tipo desconhecido, bloco vazio ou excedente: o conteúdo volta como
      // texto, sem os marcadores. O visitante nunca vê `§VISUAL§` na tela.
      buffer.push(...corpo);
    }

    index = cursor;
  }

  despejarTexto();
  return parts;
}

/**
 * A fala sem os marcadores, para quem precisa do texto puro.
 *
 * Usada onde a estrutura não cabe — a prévia de uma conversa numa lista, por
 * exemplo. As regras NÃO usam isto: elas conferem o texto salvo inteiro.
 */
export function speechToPlainText(content: string): string {
  return parseSpeech(content)
    .map((part) =>
      part.type === 'text'
        ? part.text
        : [part.block.title, ...part.block.rows.map((row) => row.cells.join(' — '))]
            .filter(Boolean)
            .join('\n'),
    )
    .join('\n\n')
    .trim();
}
