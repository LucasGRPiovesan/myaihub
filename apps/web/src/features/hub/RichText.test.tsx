import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';

/**
 * A forma da resposta é informação.
 *
 * Tudo o que o S.O dizia chegava como um parágrafo só: um comparativo entre
 * dois agentes virava prosa corrida, e reconstruir a tabela ficava por conta do
 * usuário — no painel em que ele foi justamente comparar e decidir.
 */
describe('resposta do painel', () => {
  it('monta a tabela do comparativo', () => {
    render(
      <RichText
        text={[
          '| Agente | Papel |',
          '| --- | --- |',
          '| Alex | Comercial |',
          '| Bia | Suporte |',
        ].join('\n')}
      />,
    );

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Agente',
      'Papel',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Comercial')).toBeTruthy();
  });

  it('célula faltando não desalinha a tabela', () => {
    // O modelo às vezes omite a última célula. Renderizar a linha curta
    // deslocaria as colunas seguintes e o comparativo passaria a mentir.
    render(<RichText text={['| A | B |', '| --- | --- |', '| só isto |'].join('\n')} />);

    expect(screen.getAllByRole('cell')).toHaveLength(2);
  });

  it('separa lista com e sem número', () => {
    render(<RichText text={['- um', '- dois', '', '1. primeiro', '2. segundo'].join('\n')} />);

    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('aplica ênfase e código', () => {
    render(<RichText text="use **isto** e `aquilo`" />);

    expect(screen.getByText('isto').tagName).toBe('STRONG');
    expect(screen.getByText('aquilo').tagName).toBe('CODE');
  });

  it('`**` dentro de crase é código, não negrito', () => {
    // Processar a ênfase antes do código faria um exemplo de comando virar
    // texto grosso, escondendo os asteriscos que o usuário precisa copiar.
    render(<RichText text="rode `git log --**`" />);

    expect(screen.getByText('git log --**').tagName).toBe('CODE');
  });

  it('bloco de código sai verbatim', () => {
    render(<RichText text={['```', '- não é lista', '**não é negrito**', '```'].join('\n')} />);

    expect(screen.getByText(/não é lista/)?.textContent).toContain('**não é negrito**');
  });

  it('NÃO interpreta HTML — o texto do modelo nunca vira marcação', () => {
    // Isto renderiza texto de um modelo que leu site, PDF e conversa de
    // terceiro: tudo o que o sistema já trata como UNTRUSTED. Um script aqui
    // seria XSS com o conteúdo de um PDF institucional.
    const { container } = render(<RichText text='<img src=x onerror="alert(1)"> <b>oi</b>' />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>oi</b>');
  });

  it('junta linhas soltas num parágrafo só', () => {
    const { container } = render(<RichText text={'uma frase\nque continua aqui'} />);

    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
