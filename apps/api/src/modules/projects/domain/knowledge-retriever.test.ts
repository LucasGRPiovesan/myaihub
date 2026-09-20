import { describe, expect, it } from 'vitest';
import { KeywordKnowledgeRetriever, tokenize } from './knowledge-retriever.js';

const retriever = new KeywordKnowledgeRetriever();

const ENTRADAS = [
  {
    sourceId: 'src-troca',
    revisionId: 'rev-troca',
    title: 'Política de troca',
    uri: null,
    extractedContent: [
      'Aceitamos troca em até 30 dias corridos da entrega, com nota fiscal.',
      '',
      'Peças sob medida não têm troca, porque são produzidas para o desenho do cliente.',
    ].join('\n'),
  },
  {
    sourceId: 'src-prazo',
    revisionId: 'rev-prazo',
    title: 'Prazos de produção',
    uri: null,
    extractedContent: 'O protótipo sai em cinco dias úteis depois do desenho aprovado.',
  },
];

describe('recuperação por palavra-chave', () => {
  it('traz o trecho que responde à pergunta, não o documento inteiro', () => {
    const referencias = retriever.retrieve({
      entries: ENTRADAS,
      query: 'qual o prazo do protótipo?',
      maxReferences: 3,
      maxCharsPerReference: 500,
    });

    expect(referencias[0]?.sourceId).toBe('src-prazo');
    expect(referencias[0]?.excerpt).toContain('cinco dias');
  });

  it('separa por parágrafo: o trecho certo vem sem o resto do documento', () => {
    const referencias = retriever.retrieve({
      entries: ENTRADAS,
      query: 'peça sob medida tem troca?',
      maxReferences: 1,
      maxCharsPerReference: 90,
    });

    expect(referencias[0]?.excerpt).toContain('sob medida');
    expect(referencias[0]?.excerpt).not.toContain('30 dias');
  });

  it('sem termo em comum não recupera nada — melhor vazio que ruído', () => {
    expect(
      retriever.retrieve({
        entries: ENTRADAS,
        query: 'oi tudo bem',
        maxReferences: 3,
        maxCharsPerReference: 500,
      }),
    ).toEqual([]);
  });

  it('sem fonte nenhuma não quebra', () => {
    expect(
      retriever.retrieve({
        entries: [],
        query: 'prazo',
        maxReferences: 3,
        maxCharsPerReference: 500,
      }),
    ).toEqual([]);
  });

  it('respeita o teto de referências', () => {
    const referencias = retriever.retrieve({
      entries: ENTRADAS,
      query: 'troca prazo entrega peças desenho cliente',
      maxReferences: 1,
      maxCharsPerReference: 500,
    });

    expect(referencias).toHaveLength(1);
  });

  it('devolve a pontuação: é o que explica por que este trecho e não outro', () => {
    const referencias = retriever.retrieve({
      entries: ENTRADAS,
      query: 'troca nota fiscal entrega',
      maxReferences: 3,
      maxCharsPerReference: 500,
    });

    expect(referencias[0]?.score).toBeGreaterThan(0);
  });
});

describe('tokenização', () => {
  it('ignora acento — quem escreve no chat raramente acentua', () => {
    expect(tokenize('protótipo')).toEqual(tokenize('prototipo'));
  });

  it('descarta conectivos, que não discriminam nada', () => {
    expect(tokenize('o prazo de entrega')).toEqual(['prazo', 'entrega']);
  });
});
