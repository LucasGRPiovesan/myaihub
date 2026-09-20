import { describe, expect, it } from 'vitest';
import { parseSuggestedReplies } from './suggested-replies.js';

describe('respostas recomendadas — extraídas do texto livre', () => {
  it('sem marcador: devolve o texto inteiro, sem sugestões', () => {
    const result = parseSuggestedReplies('Boa noite! Como posso ajudar?');
    expect(result.reply).toBe('Boa noite! Como posso ajudar?');
    expect(result.suggestedReplies).toEqual([]);
  });

  it('com marcador e opções válidas: separa a fala das opções', () => {
    const content = [
      'Trabalhamos com molas e estampados.',
      '',
      '§SUGESTOES§',
      '- Molas de torção',
      '- Molas de compressão',
      '- Saber mais sobre a empresa',
    ].join('\n');

    const result = parseSuggestedReplies(content);
    expect(result.reply).toBe('Trabalhamos com molas e estampados.');
    expect(result.suggestedReplies).toEqual([
      'Molas de torção',
      'Molas de compressão',
      'Saber mais sobre a empresa',
    ]);
  });

  it('marcador sem bullets válidos: fala sai limpa, sem o marcador cru vazando', () => {
    const content = 'Tudo bem por aqui!\n\n§SUGESTOES§\n(nada de bullet aqui)';
    const result = parseSuggestedReplies(content);
    expect(result.reply).toBe('Tudo bem por aqui!');
    expect(result.suggestedReplies).toEqual([]);
  });

  it('corta em 4 opções, mesmo se o modelo escrever mais', () => {
    const content = ['Ok.', '§SUGESTOES§', '- um', '- dois', '- três', '- quatro', '- cinco'].join(
      '\n',
    );

    const result = parseSuggestedReplies(content);
    expect(result.suggestedReplies).toHaveLength(4);
    expect(result.suggestedReplies).toEqual(['um', 'dois', 'três', 'quatro']);
  });

  it('corta uma opção longa demais em 80 caracteres', () => {
    const longa = 'x'.repeat(120);
    const content = `Ok.\n§SUGESTOES§\n- ${longa}`;
    const result = parseSuggestedReplies(content);
    expect(result.suggestedReplies[0]).toHaveLength(80);
  });
});
