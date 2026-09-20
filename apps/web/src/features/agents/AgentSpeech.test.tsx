import { VISUAL_BLOCK_END, VISUAL_BLOCK_MARKER } from '@myaihub/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentSpeech } from './AgentSpeech';

/**
 * A GARANTIA ESTRUTURAL: quando só há DUAS opções e o modelo marca vantagem
 * só de um lado, o lado que falta INFERE o oposto.
 *
 * Testado com usuário real, três formulações de instrução seguidas: o modelo
 * marcava de bom grado o lado favorável e parava por aí — a metade
 * desfavorável ficava sem "- " mesmo pedindo explicitamente as duas. Regra que
 * sobrevive a três redações e continua falhando não é problema de redação; é
 * garantia que precisa estar no domínio, não no prompt.
 */
describe('comparativo com vantagem/desvantagem', () => {
  const comparativoComUmLadoMarcado = [
    'Terceirizar com a gente traz algumas vantagens claras:',
    `${VISUAL_BLOCK_MARKER} comparativo`,
    'Critério | Terceirizar | Fabricar internamente',
    'Tempo de parada | + Produção imediata | Espera pela fabricação do ferramental',
    'Investimento | + Custo direto na peça | Custo alto com molde e manutenção',
    VISUAL_BLOCK_END,
  ].join('\n');

  it('infere o lado oposto quando só uma coluna foi marcada', () => {
    render(<AgentSpeech content={comparativoComUmLadoMarcado} />);

    // Os textos aparecem sem o marcador "+"/"-" cru.
    expect(screen.getByText('Produção imediata')).toBeInTheDocument();
    expect(screen.getByText('Espera pela fabricação do ferramental')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();

    // O lado sem marca recebeu a cor de DESVANTAGEM por inferência.
    const desfavoravel = screen.getByText('Espera pela fabricação do ferramental');
    expect(desfavoravel.closest('dd')).toHaveClass('text-danger');

    const favoravel = screen.getByText('Produção imediata');
    expect(favoravel.closest('dd')).toHaveClass('text-success');
  });

  it('não marca nada quando nenhum lado tem sinal — critério puramente descritivo', () => {
    const conteudo = [
      `${VISUAL_BLOCK_MARKER} comparativo`,
      'Critério | Mola de compressão | Mola de tração',
      'Uso | Absorve força de compressão | Absorve força de tração',
      VISUAL_BLOCK_END,
    ].join('\n');

    render(<AgentSpeech content={conteudo} />);

    const celula = screen.getByText('Absorve força de compressão').closest('dd');
    expect(celula).not.toHaveClass('text-success');
    expect(celula).not.toHaveClass('text-danger');
    expect(celula).toHaveClass('text-text');
  });

  it('com três opções, não inventa o oposto — fica neutro sem palpite', () => {
    const conteudo = [
      `${VISUAL_BLOCK_MARKER} comparativo`,
      'Critério | Opção A | Opção B | Opção C',
      'Custo | + Mais barata | Custo médio | Mais cara',
      VISUAL_BLOCK_END,
    ].join('\n');

    render(<AgentSpeech content={conteudo} />);

    const semMarca = screen.getByText('Custo médio').closest('dd');
    expect(semMarca).not.toHaveClass('text-success');
    expect(semMarca).not.toHaveClass('text-danger');
  });
});
