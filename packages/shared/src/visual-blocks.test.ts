import { describe, expect, it } from 'vitest';
import { parseSpeech, speechToPlainText, VISUAL_BLOCK_MARKER } from './visual-blocks.js';

describe('parseSpeech', () => {
  it('fala sem marcador continua sendo um texto só', () => {
    const parts = parseSpeech('Bom dia. Como posso ajudar?');

    expect(parts).toEqual([{ type: 'text', text: 'Bom dia. Como posso ajudar?' }]);
  });

  it('separa texto e bloco preservando a ORDEM em que foram escritos', () => {
    const parts = parseSpeech(
      [
        'O processo tem três etapas:',
        `${VISUAL_BLOCK_MARKER} passos`,
        'titulo: Como funciona',
        'Envio | Você manda o desenho',
        'Análise | Conferimos o material',
        '§FIM§',
        'Qual desses você já tem em mãos?',
      ].join('\n'),
    );

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', text: 'O processo tem três etapas:' });
    expect(parts[2]).toEqual({ type: 'text', text: 'Qual desses você já tem em mãos?' });

    const bloco = parts[1];
    if (bloco?.type !== 'block') throw new Error('esperava um bloco no meio');
    expect(bloco.block.kind).toBe('passos');
    expect(bloco.block.title).toBe('Como funciona');
    expect(bloco.block.rows).toEqual([
      { cells: ['Envio', 'Você manda o desenho'] },
      { cells: ['Análise', 'Conferimos o material'] },
    ]);
  });

  it('descarta a linha divisória de tabela em markdown', () => {
    const parts = parseSpeech(
      [
        `${VISUAL_BLOCK_MARKER} comparativo`,
        '| Critério | Mola A | Mola B |',
        '|---|---|---|',
        '| Prazo | 3 dias | 10 dias |',
        '§FIM§',
      ].join('\n'),
    );

    const bloco = parts[0];
    if (bloco?.type !== 'block') throw new Error('esperava um bloco');
    expect(bloco.block.rows).toEqual([
      { cells: ['Critério', 'Mola A', 'Mola B'] },
      { cells: ['Prazo', '3 dias', '10 dias'] },
    ]);
  });

  /*
    Um tipo que não existe é erro do modelo, e erro do modelo não pode virar
    símbolo interno na tela de um visitante anônimo. Mesma regra do aplicador de
    mutações: a FORMA errada não descarta o conteúdo.
  */
  it('tipo desconhecido volta como texto, sem o marcador', () => {
    const parts = parseSpeech(
      [`${VISUAL_BLOCK_MARKER} grafico3d`, 'Alguma coisa aqui', '§FIM§'].join('\n'),
    );

    expect(parts).toEqual([{ type: 'text', text: 'Alguma coisa aqui' }]);
  });

  it('bloco sem linha nenhuma não vira moldura vazia', () => {
    const parts = parseSpeech([`${VISUAL_BLOCK_MARKER} pontos`, '§FIM§'].join('\n'));

    expect(parts).toEqual([]);
  });

  /*
    O Lab revela a fala letra a letra: sem esta regra o visitante lê "§VISU" na
    tela antes de o marcador se completar.
  */
  it('esconde um marcador que ainda está chegando', () => {
    const parts = parseSpeech('Olha só como funciona:\n§VISU');

    expect(parts).toEqual([{ type: 'text', text: 'Olha só como funciona:' }]);
  });

  it('bloco sem fim ainda mostra o que chegou — stream cortado no meio', () => {
    const parts = parseSpeech(
      ['Veja:', `${VISUAL_BLOCK_MARKER} pontos`, 'Entrega rápida | em 3 dias'].join('\n'),
    );

    const bloco = parts[1];
    if (bloco?.type !== 'block') throw new Error('esperava um bloco');
    expect(bloco.block.rows).toEqual([{ cells: ['Entrega rápida', 'em 3 dias'] }]);
  });

  it('lê o ícone semântico quando bate com o vocabulário fechado', () => {
    const parts = parseSpeech(
      [`${VISUAL_BLOCK_MARKER} pontos`, 'truck | Entrega rápida | em 3 dias', '§FIM§'].join('\n'),
    );

    const bloco = parts[0];
    if (bloco?.type !== 'block') throw new Error('esperava um bloco');
    expect(bloco.block.rows).toEqual([{ cells: ['Entrega rápida', 'em 3 dias'], icon: 'truck' }]);
  });

  it('célula que não bate com o vocabulário continua sendo CONTEÚDO, não ícone', () => {
    const parts = parseSpeech(
      [`${VISUAL_BLOCK_MARKER} pontos`, 'foguete | Entrega rápida | em 3 dias', '§FIM§'].join('\n'),
    );

    const bloco = parts[0];
    if (bloco?.type !== 'block') throw new Error('esperava um bloco');
    expect(bloco.block.rows).toEqual([{ cells: ['foguete', 'Entrega rápida', 'em 3 dias'] }]);
  });

  it('comparativo e ficha NÃO extraem ícone — a primeira célula é dado', () => {
    const parts = parseSpeech(
      [`${VISUAL_BLOCK_MARKER} ficha`, 'truck | Prazo médio', '§FIM§'].join('\n'),
    );

    const bloco = parts[0];
    if (bloco?.type !== 'block') throw new Error('esperava um bloco');
    expect(bloco.block.rows).toEqual([{ cells: ['truck', 'Prazo médio'] }]);
  });

  it('limita a quantidade de blocos numa fala só', () => {
    const um = [`${VISUAL_BLOCK_MARKER} pontos`, 'A | b', '§FIM§'].join('\n');
    const parts = parseSpeech([um, um, um, um, um, um].join('\n'));

    expect(parts.filter((part) => part.type === 'block')).toHaveLength(4);
  });
});

describe('speechToPlainText', () => {
  it('achata o bloco para onde a estrutura não cabe', () => {
    const texto = speechToPlainText(
      ['Segue:', `${VISUAL_BLOCK_MARKER} ficha`, 'Material | Aço 1070', '§FIM§'].join('\n'),
    );

    expect(texto).toBe('Segue:\n\nMaterial — Aço 1070');
  });
});
