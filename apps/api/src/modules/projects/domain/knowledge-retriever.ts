import type { KnowledgeReference } from '@myaihub/shared';
import type { SnapshotEntry } from './knowledge-repositories.js';

/**
 * Recuperação de conhecimento (§4.4; RAG vetorial fica fora do MVP).
 *
 * É keyword sobre o snapshot CONGELADO, e a escolha é deliberada: um índice
 * vetorial precisa de um serviço a mais, de reindexação e de um custo por
 * embedding, e nenhuma dessas três coisas melhora o produto enquanto o volume
 * de conhecimento de um projeto cabe em alguns documentos. O port existe para
 * que trocar isto não toque em use case nenhum.
 *
 * Duas propriedades que qualquer substituto precisa manter:
 *
 * Lê do SNAPSHOT, nunca da fonte corrente — senão a publicação deixaria de ser
 * reproduzível no dia em que alguém reindexar.
 *
 * Devolve o TRECHO que entrou, com a pontuação. Sem isso, "o agente respondeu
 * com base no conhecimento" é uma afirmação que ninguém consegue conferir, e o
 * `ExecutionTrace` guardaria um id de snapshot sem saber o que dele foi usado.
 */
export interface KnowledgeRetriever {
  retrieve(input: {
    entries: SnapshotEntry[];
    query: string;
    maxReferences: number;
    maxCharsPerReference: number;
  }): KnowledgeReference[];
}

/** Palavras curtas e conectivos não discriminam nada e inflam toda pontuação. */
const STOPWORDS = new Set([
  'a',
  'as',
  'ao',
  'aos',
  'com',
  'como',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'ele',
  'ela',
  'essa',
  'esse',
  'esta',
  'este',
  'eu',
  'foi',
  'isso',
  'já',
  'la',
  'lo',
  'mais',
  'mas',
  'me',
  'meu',
  'na',
  'nas',
  'no',
  'nos',
  'não',
  'o',
  'os',
  'ou',
  'para',
  'pela',
  'pelo',
  'por',
  'que',
  'se',
  'sem',
  'ser',
  'seu',
  'sua',
  'são',
  'tem',
  'um',
  'uma',
  'vc',
  'você',
  'vocês',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Divide o conteúdo em blocos de parágrafo.
 *
 * Por parágrafo e não por caractere: cortar no meio de uma frase entrega ao
 * modelo meia informação, e meia informação sobre preço ou prazo é pior que
 * nenhuma — ele completa o resto.
 */
function chunk(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 <= maxChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    // Parágrafo maior que o teto sozinho: entra cortado, mas inteiro ele
    // estouraria o orçamento de contexto de um turno.
    current = paragraph.length > maxChars ? paragraph.slice(0, maxChars) : paragraph;
  }

  if (current) chunks.push(current);
  return chunks;
}

export class KeywordKnowledgeRetriever implements KnowledgeRetriever {
  retrieve(input: {
    entries: SnapshotEntry[];
    query: string;
    maxReferences: number;
    maxCharsPerReference: number;
  }): KnowledgeReference[] {
    const terms = new Set(tokenize(input.query));
    if (terms.size === 0) return [];

    const scored: KnowledgeReference[] = [];

    for (const entry of input.entries) {
      for (const piece of chunk(entry.extractedContent, input.maxCharsPerReference)) {
        const words = tokenize(piece);
        if (words.length === 0) continue;

        // TERMOS DISTINTOS que bateram, não ocorrências. Contar ocorrências
        // premiaria o trecho que repete a mesma palavra dez vezes sobre o que
        // responde à pergunta inteira uma vez só.
        const matched = new Set(words.filter((word) => terms.has(word)));
        if (matched.size === 0) continue;

        scored.push({
          sourceId: entry.sourceId,
          revisionId: entry.revisionId,
          title: entry.title,
          excerpt: piece,
          score: matched.size,
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score || a.excerpt.length - b.excerpt.length)
      .slice(0, input.maxReferences);
  }
}
