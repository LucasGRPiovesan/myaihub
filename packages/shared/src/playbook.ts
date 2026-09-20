import { z } from 'zod';

/**
 * Playbook de OFÍCIO: o que faz alguém ser bom NAQUELE papel.
 *
 * A `craft` da Master Policy manda o OS DERIVAR o ofício em vez de perguntá-lo.
 * Só que a única fonte desse ofício era o que o modelo por acaso soubesse — e
 * um `flash-lite` perguntado sobre "como trabalha um representante comercial
 * estratégico" devolve platitude. Medido: o agente nascia empurrando produto no
 * primeiro turno, antes de entender qualquer coisa, e o usuário precisava
 * corrigir à mão o que o sistema deveria saber.
 *
 * O playbook é o piso profissional daquele papel, escrito uma vez e versionado.
 * Três coisas que ele NÃO é:
 *
 *   Não é template de saída. Ele entra como CONTEXTO; quem escreve os itens
 *   canônicos continua sendo o modelo, pelas mesmas Operations tipadas e pelas
 *   mesmas mutações. Não existe `if (role === 'vendedor')` gerando configuração.
 *
 *   Não é o documento de pesquisa. O estudo que o originou tem dezenas de
 *   milhares de tokens; isto é a destilação. Instrução longa esconde o contrato
 *   de saída — já custou `identity` e `objective` omitidos.
 *
 *   Não é conhecimento de runtime. Vale em tempo de PROJETO. O prompt publicado
 *   continua compilado do canônico, senão a publicação deixa de ser
 *   reproduzível (invariante 7).
 */
/**
 * Playbook que é PISO, não papel.
 *
 * Vale para todo agente e por isso nunca entra no catálogo do classificador: não
 * é uma opção entre outras, é o mínimo de todas.
 */
export const CORE_PLAYBOOK_KEY = 'core.conduct';

/**
 * A chave de um ofício que ainda está nascendo.
 *
 * Existe porque a criação pelo OS parte de um documento vazio e a chave real
 * chega por mutação. É esta constante que o aplicador compara para decidir se
 * pode gravar a chave — num ofício que já tem endereço, ela é imutável.
 */
export const PLACEHOLDER_PLAYBOOK_KEY = 'novo.playbook';

/**
 * Identidade dos itens do playbook.
 *
 * `semanticKey` é o CONCEITO, estável: é por ele que o OS refina um princípio em
 * vez de criar outro dizendo a mesma coisa, e é o que permite mutação cirúrgica
 * — o item que ninguém citou não passa nem perto do modelo. `code` é o rótulo
 * curto que o admin cita ("PR03") e o painel exibe.
 *
 * Mesma forma do resto do canônico (§5.1), e não por simetria: é ela que faz o
 * `guardAgainstRegression` funcionar aqui sem uma linha a mais.
 */
const itemIdentity = {
  code: z.string().trim().min(2).max(10),
  semanticKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
    .max(80),
  label: z.string().trim().min(3).max(80),
};

export const PLAYBOOK_FACETS = [
  'personality',
  'communication',
  'skills',
  'behaviors',
  'strategies',
  'hardRules',
] as const;

export type PlaybookFacet = (typeof PLAYBOOK_FACETS)[number];

const principleSchema = z.object({
  ...itemIdentity,
  facet: z.enum(PLAYBOOK_FACETS),
  statement: z.string().trim().min(20).max(700),
  /**
   * Quão obrigatório é este princípio no agente que herdá-lo.
   *
   * A maioria é orientação de ofício — SOFT, e o modelo pondera. Alguns são
   * PROIBIÇÃO, e para esses a diferença é concreta: no prompt do agente, item
   * HARD sobe para o bloco "REGRAS INEGOCIÁVEIS" e sai do meio da lista da
   * faceta. Sem poder declarar isso, o piso entrava sempre como preferência e
   * um "é proibido supor" chegava com o mesmo peso de "prefira ir devagar".
   */
  enforcement: z.enum(['SOFT', 'HARD']).optional(),
});

const limitSchema = z.object({
  ...itemIdentity,
  statement: z.string().trim().min(10).max(400),
});

const questionSchema = z.object({
  code: itemIdentity.code,
  semanticKey: itemIdentity.semanticKey,
  question: z.string().trim().min(5).max(160),
  /** O que muda no agente conforme a resposta. Sem isto ele responde no escuro. */
  why: z.string().trim().min(5).max(200),
  placeholder: z.string().trim().max(120).default(''),
});

export type PlaybookPrinciple = z.infer<typeof principleSchema>;
export type PlaybookLimit = z.infer<typeof limitSchema>;
export type PlaybookQuestion = z.infer<typeof questionSchema>;

export const agentPlaybookSchema = z.object({
  /** Chave estável. É por ela que o classificador escolhe. */
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'Use minúsculas e ponto: `sales.consultive`.')
    .max(60),
  /** Nome legível — o que o admin e o log mostram. */
  label: z.string().trim().min(3).max(80),
  /**
   * Como o classificador reconhece o papel.
   *
   * Frases em linguagem natural, não regex: quem casa papel com playbook é o
   * modelo, no mesmo turno do briefing. Uma lista de palavras-chave nunca
   * cobriria "consultor de vendas para clínicas".
   */
  appliesTo: z.array(z.string().trim().min(3).max(120)).min(1).max(12),
  /** A tese do ofício em uma frase. É o que o agente PRECISA ser. */
  thesis: z.string().trim().min(20).max(600),
  /**
   * Princípios prescritivos, cada um com a FACETA em que entra.
   *
   * A faceta vem do playbook, não do modelo, por uma razão medida: sem ela o
   * modelo distribuía os princípios como queria e parava na cobertura mínima —
   * catorze princípios viravam nove itens, e os cinco perdidos eram justamente
   * os específicos do ofício. Com a faceta declarada, o alvo por faceta é um
   * NÚMERO que ele consegue conferir antes de responder.
   *
   * Quem cura o playbook sabe a que faceta cada princípio pertence; é
   * conhecimento de quem escreveu, não adivinhação de quem gera.
   */
  principles: z.array(principleSchema).min(3).max(30),
  /** O que NUNCA fazer neste papel. Vira limite — proibição do ofício. */
  antiPatterns: z.array(limitSchema).max(20).default([]),
  /**
   * O que o ofício JÁ responde — o briefing não pode perguntar isto.
   *
   * Era a queixa direta: o OS perguntava ao usuário coisas que ele mesmo
   * deveria saber para projetar o agente.
   */
  alreadyAnswered: z.array(z.string().trim().min(5).max(200)).max(15).default([]),
  /**
   * As perguntas que o briefing FAZ para este papel.
   *
   * Curadas, não inventadas a cada criação: quando existe playbook, ele é quem
   * sabe o que vale perguntar naquele ofício — e o modelo não precisa adivinhar
   * (nem varia a cada chamada, §31). Só entra aqui FATO que o usuário sabe e o
   * ofício não responde.
   */
  worthAsking: z.array(questionSchema).max(6).default([]),
  /** De onde veio. Sem isto ninguém consegue auditar uma afirmação de ofício. */
  sources: z.array(z.string().trim().min(3).max(300)).max(20).default([]),
});

export type AgentPlaybook = z.infer<typeof agentPlaybookSchema>;
