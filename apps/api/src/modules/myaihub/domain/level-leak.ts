/**
 * O NOME DE OUTRO NÍVEL NÃO ENTRA NESTE.
 *
 * O agente é da CONTA e atua em qualquer projeto e qualquer campanha. A seção
 * "information_level" da Master Policy diz isso desde o começo — e mesmo assim,
 * pedido dentro de um projeto, o S.O criou "Sankar Atendimento", com objetivo
 * "qualificar demandas para os produtos da Linha Industrial Sankar", e no ajuste
 * seguinte escreveu a mesma campanha numa skill. O agente passou a carregar UM
 * negócio para toda conversa que tiver, inclusive nas campanhas de outro.
 *
 * Regra de policy disputa atenção com a conversa inteira, e a conversa estava
 * falando justamente daquele negócio. O que a separa aqui é um fato que o
 * domínio conhece sem ajuda do modelo: os NOMES dos projetos e campanhas da
 * conta. Nome próprio de outro nível dentro do texto do agente não tem leitura
 * benigna — é o termo que só existe naquele caso.
 *
 * Por que só o nome, e não "qualquer coisa do negócio": procurar vocabulário
 * erra nos dois sentidos (ver a nota do detector de vazamento no CLAUDE.md). O
 * nome é o único sinal que não tem falso positivo razoável; o resto do nível —
 * produto, público, preço — continua sendo trabalho da policy.
 */

/** Campos de TEXTO de uma mutação — o que vira fala ou instrução do agente. */
const TEXT_KEYS = new Set([
  'name',
  'role',
  'archetype',
  'primary',
  'secondary',
  'opener',
  'openerGuidance',
  'label',
  'statement',
  'rationale',
]);

/** Nome curto demais casa com pedaço de palavra comum e acusaria à toa. */
const MIN_TERM_LENGTH = 3;

export interface LevelTerm {
  /** O nome como o usuário o cadastrou. */
  term: string;
  /** De onde ele é — é isso que a correção diz ao modelo. */
  level: 'PROJECT' | 'CAMPAIGN';
}

export interface LevelLeak {
  /** Posição da mutação na lista, para descartar só ela se a correção falhar. */
  index: number;
  kind: string;
  /** Rótulo legível do item: o `label`, quando há. */
  where: string;
  term: string;
  level: LevelTerm['level'];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Casa o nome como NOME: com a grafia cadastrada ou em caixa alta, e inteiro.
 *
 * Sem ignorar caixa de propósito. Um projeto chamado "Consultoria" existe, e em
 * minúscula a palavra é ofício — aparece em metade dos itens de um agente
 * consultivo. Escrito como foi cadastrado, é o nome.
 */
function termPattern(term: string): RegExp {
  const variantes = [...new Set([term, term.toUpperCase()])].map(escapeRegex);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${variantes.join('|')})(?![\\p{L}\\p{N}])`, 'u');
}

function textsOf(mutation: Record<string, unknown>): string[] {
  const textos: string[] = [];
  for (const [key, value] of Object.entries(mutation)) {
    if (!TEXT_KEYS.has(key)) continue;
    if (typeof value === 'string') textos.push(value);
    if (Array.isArray(value)) {
      textos.push(...value.filter((item): item is string => typeof item === 'string'));
    }
  }
  return textos;
}

/**
 * Nomes de outro nível escritos nas mutações.
 *
 * Remoção não é olhada: o `reason` dela pode citar o projeto justamente para
 * dizer por que o item saiu, e tirar item contaminado é a correção, não o erro.
 */
export function findLevelLeaks(
  mutations: ReadonlyArray<{ kind: string; [key: string]: unknown }>,
  terms: readonly LevelTerm[],
): LevelLeak[] {
  const candidatos = terms
    .filter((entry) => entry.term.trim().length >= MIN_TERM_LENGTH)
    // O nome mais longo primeiro: "Linha Industrial Sankar" contém "Sankar", e
    // dizer ao modelo o nome da CAMPANHA explica melhor que o do projeto.
    .sort((a, b) => b.term.length - a.term.length)
    .map((entry) => ({ ...entry, pattern: termPattern(entry.term.trim()) }));

  if (candidatos.length === 0) return [];

  const leaks: LevelLeak[] = [];

  mutations.forEach((mutation, index) => {
    if (mutation.kind.startsWith('REMOVE_')) return;

    const record = mutation as Record<string, unknown>;
    const textos = textsOf(record);
    const achado = candidatos.find((entry) => textos.some((texto) => entry.pattern.test(texto)));
    if (!achado) return;

    const label = typeof record['label'] === 'string' ? record['label'] : null;
    leaks.push({
      index,
      kind: mutation.kind,
      where: label ? `${mutation.kind} "${label}"` : mutation.kind,
      term: achado.term.trim(),
      level: achado.level,
    });
  });

  return leaks;
}

const LEVEL_NAME: Record<LevelTerm['level'], string> = {
  PROJECT: 'do PROJETO',
  CAMPAIGN: 'da CAMPANHA',
};

/**
 * A correção devolvida ao modelo: o termo, onde ele está e a SAÍDA.
 *
 * Proibição sem saída faz o modelo travar ou apagar o item inteiro. A saída
 * aqui é dupla: o item continua existindo, escrito para qualquer negócio; e o
 * que só vale para este negócio é dito ao usuário como coisa da campanha.
 */
export function levelLeakCorrection(leaks: readonly LevelLeak[]): string {
  return [
    'Sua resposta escreveu, na BASE do agente, nomes que pertencem a outro nível:',
    ...leaks.map((leak) => `  - ${leak.where}: "${leak.term}" é ${LEVEL_NAME[leak.level]}`),
    '',
    'O agente é da CONTA e atua em qualquer projeto e campanha. Nome de projeto,',
    'empresa, campanha, linha ou produto não pode aparecer na identidade, no',
    'objetivo nem em item nenhum dele — nem no nome do agente.',
    '',
    'Responda de novo com o MESMO trabalho, reescrevendo só esses campos sem o',
    'nome: "o produto em foco", "a oferta da campanha", "o negócio para o qual',
    'estiver atuando". O nome do agente sai do PAPEL, não do negócio. O que só',
    'vale para este negócio não some: diga em `humanSummary` que isso pertence à',
    'campanha (ou ao projeto) e ofereça registrar lá.',
  ].join('\n');
}
