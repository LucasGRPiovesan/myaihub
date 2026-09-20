/**
 * Respostas recomendadas — sinal extraído de dentro do texto livre.
 *
 * `agent.runtime` fala por `gateway.generate()` — texto puro, não
 * `generateStructured` (§ latência: uma segunda chamada, ou uma saída
 * estruturada, dobraria a espera do turno de conversa — a mesma razão que já
 * fez a auditoria semântica virar assíncrona). Não há chamada nova aqui: o
 * modelo já escreve a fala normal e, só quando fizer sentido estratégico,
 * anexa um marcador reconhecível com as opções — mesma classe do que já
 * detecta CTA oferecido (substring na resposta), só que agora é o próprio
 * modelo que produz o sinal, não algo que já sabíamos de antemão.
 */

export const SUGGESTED_REPLIES_MARKER = '§SUGESTOES§';

const MAX_SUGGESTIONS = 4;
const MAX_SUGGESTION_LENGTH = 80;

export interface ParsedReply {
  /** A fala visível — nunca contém o marcador nem as linhas de opção. */
  reply: string;
  /** Vazio quando o marcador não apareceu, ou apareceu sem opção válida. */
  suggestedReplies: string[];
}

export function parseSuggestedReplies(content: string): ParsedReply {
  const markerIndex = content.indexOf(SUGGESTED_REPLIES_MARKER);
  if (markerIndex === -1) {
    return { reply: content.trim(), suggestedReplies: [] };
  }

  const reply = content.slice(0, markerIndex).trim();
  const tail = content.slice(markerIndex + SUGGESTED_REPLIES_MARKER.length);

  const suggestedReplies = tail
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_SUGGESTIONS)
    .map((line) =>
      line.length > MAX_SUGGESTION_LENGTH ? line.slice(0, MAX_SUGGESTION_LENGTH) : line,
    );

  return { reply, suggestedReplies };
}
