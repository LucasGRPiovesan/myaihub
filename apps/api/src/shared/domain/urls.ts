/**
 * URLs http(s) presentes num texto livre.
 *
 * Vive no domínio, e não junto do leitor web, porque é o RUNNER que decide que
 * uma menção a site vira contexto — e `application/` não importa de
 * `infrastructure/` (invariante 2).
 */
export function extractUrls(text: string, limit = 2): string[] {
  const found = text.match(/https?:\/\/[^\s<>()"'\]]+/gi) ?? [];
  const unique: string[] = [];

  for (const raw of found) {
    // Pontuação final grudada na URL é do texto, não do endereço.
    const url = raw.replace(/[.,;:!?)]+$/, '');
    if (!unique.includes(url)) unique.push(url);
    if (unique.length >= limit) break;
  }

  return unique;
}
