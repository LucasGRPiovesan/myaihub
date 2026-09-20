import { Fragment, type ReactNode } from 'react';
import { cx } from '../../design-system/primitives';

/**
 * A RESPOSTA DO S.O, RENDERIZADA COMO ELA FOI ESCRITA.
 *
 * Tudo o que ele dizia chegava como um parágrafo só. Peça um comparativo entre
 * dois agentes e a resposta certa é uma TABELA; peça o que falta num projeto e
 * é uma LISTA. Achatar as duas em prosa corrida transfere ao usuário o trabalho
 * de reconstruir a estrutura que o modelo já tinha produzido — e o painel é
 * justamente onde ele vai comparar e decidir.
 *
 * ========== POR QUE ESCRITO À MÃO, E NÃO UMA BIBLIOTECA ==========
 *
 * Não é economia de dependência: é SEGURANÇA. Isto renderiza texto vindo de um
 * modelo, que por sua vez leu conteúdo de site, PDF e conversa de terceiro —
 * tudo o que o sistema já trata como UNTRUSTED. Um renderizador de markdown
 * genérico aceita HTML embutido e precisa de sanitização correta para não virar
 * XSS; aqui nada é interpretado como HTML em momento nenhum. Cada pedaço vira
 * um nó React com texto, e o que não for reconhecido aparece como o texto que
 * é. Não existe `dangerouslySetInnerHTML` neste arquivo, e não deve passar a
 * existir.
 *
 * O subconjunto é o que a resposta de um operador realmente usa: título, lista
 * (com e sem número), tabela, citação, código e ênfase. Deliberadamente sem
 * imagem e sem link arbitrário — os caminhos internos do produto já viajam em
 * `touched` e no `workspace.patch`, que são tipados e conferidos.
 */

type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

/**
 * Quebra uma linha em pedaços com ênfase.
 *
 * O código vem primeiro porque `**` dentro de crase é código, não negrito —
 * processar a ênfase antes faria o exemplo de um comando virar texto grosso.
 */
function parseInline(line: string): Inline[] {
  const pieces: Inline[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(__[^_]+__)/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > cursor) pieces.push({ text: line.slice(cursor, match.index) });

    const token = match[0];
    if (token.startsWith('`')) pieces.push({ text: token.slice(1, -1), code: true });
    else if (token.startsWith('**') || token.startsWith('__'))
      pieces.push({ text: token.slice(2, -2), bold: true });
    else pieces.push({ text: token.slice(1, -1), italic: true });

    cursor = match.index + token.length;
  }

  if (cursor < line.length) pieces.push({ text: line.slice(cursor) });
  return pieces.length > 0 ? pieces : [{ text: line }];
}

function Inlines({ line }: { line: string }) {
  return (
    <>
      {parseInline(line).map((piece, index) => {
        if (piece.code) {
          return (
            <code
              key={index}
              className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[12px]"
            >
              {piece.text}
            </code>
          );
        }
        if (piece.bold) {
          return (
            <strong key={index} className="font-semibold text-text">
              {piece.text}
            </strong>
          );
        }
        if (piece.italic) return <em key={index}>{piece.text}</em>;
        return <Fragment key={index}>{piece.text}</Fragment>;
      })}
    </>
  );
}

/** Uma linha de tabela em `| a | b |`, já sem as bordas. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

const isTableRow = (line: string): boolean => line.trim().startsWith('|') && line.includes('|', 1);
/** A linha `|---|---|` que separa cabeçalho de corpo. Ela não é conteúdo. */
const isTableDivider = (line: string): boolean => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: ReactNode[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // --- Bloco de código: tudo dentro vai VERBATIM, sem ênfase nem tabela.
    if (line.trim().startsWith('```')) {
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        buffer.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      nodes.push(
        <pre
          key={nodes.length}
          className="overflow-x-auto rounded-[var(--radius-control)] bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed"
        >
          {buffer.join('\n')}
        </pre>,
      );
      continue;
    }

    // --- Tabela. É o que o comparativo pede, e o motivo de este arquivo existir.
    if (isTableRow(line) && isTableDivider(lines[index + 1] ?? '')) {
      const header = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(splitRow(lines[index] ?? ''));
        index += 1;
      }

      nodes.push(
        // A rolagem é do CONTAINER, nunca da página: um comparativo de cinco
        // colunas num painel de 25% não pode fazer a aplicação rolar de lado.
        <div key={nodes.length} className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    className="border-b border-border px-2 py-1.5 text-left font-semibold"
                  >
                    <Inlines line={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b border-border px-2 py-1.5 align-top text-text-muted"
                    >
                      <Inlines line={row[cellIndex] ?? ''} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // --- Título. Três níveis bastam: o painel é estreito e uma hierarquia
    // profunda ali vira ruído em vez de estrutura.
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      nodes.push(
        <p
          key={nodes.length}
          className={cx(
            'font-semibold text-text',
            level === 1 ? 'text-[15px]' : level === 2 ? 'text-[14px]' : 'text-[13px]',
          )}
        >
          <Inlines line={heading[2] ?? ''} />
        </p>,
      );
      index += 1;
      continue;
    }

    // --- Lista numerada.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ol key={nodes.length} className="ml-4 flex list-decimal flex-col gap-1">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <Inlines line={item} />
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // --- Lista simples.
    if (/^\s*[-*·]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*·]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*·]\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ul key={nodes.length} className="ml-4 flex list-disc flex-col gap-1">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <Inlines line={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // --- Citação.
    if (/^\s*>\s?/.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        buffer.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      nodes.push(
        <blockquote
          key={nodes.length}
          className="border-l-2 border-border pl-3 italic text-text-subtle"
        >
          <Inlines line={buffer.join(' ')} />
        </blockquote>,
      );
      continue;
    }

    // --- Parágrafo: junta as linhas até a próxima em branco ou o próximo bloco.
    const buffer: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        current.trim() === '' ||
        /^(#{1,3})\s+/.test(current) ||
        /^\s*[-*·]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current) ||
        /^\s*>\s?/.test(current) ||
        current.trim().startsWith('```') ||
        isTableRow(current)
      ) {
        break;
      }
      buffer.push(current);
      index += 1;
    }

    nodes.push(
      <p key={nodes.length}>
        <Inlines line={buffer.join(' ')} />
      </p>,
    );
  }

  return <div className={cx('flex flex-col gap-2.5 leading-relaxed', className)}>{nodes}</div>;
}
