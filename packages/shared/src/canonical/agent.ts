import { z } from 'zod';
import { canonicalItemSchema } from './item.js';
import type { CanonicalSchemaSet } from './migrate.js';

/**
 * Agent Core canônico (§7 do prompt de produto).
 *
 * A taxonomia é FECHADA e as facetas são distintas de propósito. A distinção
 * que mais importa na prática:
 *
 *   personality    como o agente É       (pragmático, paciente, analítico)
 *   communication  como ele SE COMUNICA  (objetivo, didático, consultivo)
 *
 * Colapsar as duas em "skills" — que é o que sistemas de prompt costumam fazer —
 * impede o Context Compiler de tratá-las com prioridades diferentes, e impede o
 * usuário de ajustar uma sem mexer na outra.
 */

/** Prefixos de `code` por faceta. */
export const AGENT_FACET_CODES = {
  personality: 'PS',
  communication: 'CM',
  skills: 'SK',
  behaviors: 'BH',
  strategies: 'ST',
  hardRules: 'HR',
  limits: 'LM',
} as const;

export type AgentFacet = keyof typeof AGENT_FACET_CODES;

/**
 * Vocabulário de `semanticKey` por faceta.
 *
 * Prefixo controlado, chave livre dentro dele: é o que permite deduplicar
 * ("seja objetivo" e "não explique demais" → `communication.objectivity`) sem
 * transformar o canônico num EAV.
 */
export const AGENT_SEMANTIC_KEY_PREFIXES: Record<AgentFacet, string> = {
  personality: 'personality',
  communication: 'communication',
  skills: 'skill',
  behaviors: 'behavior',
  strategies: 'strategy',
  hardRules: 'hard_rule',
  limits: 'limit',
};

/** Ver PROJECT_FACET_MUTATION: mesmo motivo, mesmo contrato. */
export const AGENT_FACET_MUTATION: Record<AgentFacet, string> = {
  personality: 'UPSERT_PERSONALITY_TRAIT',
  communication: 'UPSERT_COMMUNICATION_TRAIT',
  skills: 'UPSERT_SKILL',
  behaviors: 'UPSERT_BEHAVIOR',
  strategies: 'UPSERT_STRATEGY',
  hardRules: 'UPSERT_HARD_RULE',
  limits: 'UPSERT_LIMIT',
};

export const AGENT_REMOVE_MUTATION = 'REMOVE_AGENT_ITEM';

/**
 * Slug de URL de cada faceta.
 *
 * Vive aqui, e não na rota, porque é contrato: o link do painel, o item da
 * sidebar e o parâmetro da rota precisam concordar. Derivar o slug do nome da
 * faceta em três lugares diferentes é como esses três divergem.
 *
 * Em português porque a URL é interface — `/agentes/x/personalidade` diz o que
 * é para quem está olhando a barra de endereço.
 */
export const AGENT_FACET_SLUGS: Record<AgentFacet, string> = {
  personality: 'personalidade',
  communication: 'comunicacao',
  skills: 'skills',
  behaviors: 'comportamentos',
  strategies: 'estrategias',
  hardRules: 'regras',
  limits: 'limites',
};

/** `null` quando o slug não corresponde a faceta nenhuma. */
export function facetFromSlug(slug: string): AgentFacet | null {
  const entry = Object.entries(AGENT_FACET_SLUGS).find(([, value]) => value === slug);
  return entry ? (entry[0] as AgentFacet) : null;
}

export const canonicalAgentV1Schema = z.object({
  /**
   * Playbook de ofício que serviu de baseline para este agente.
   *
   * Proveniência, não comportamento: o que o playbook diz já está escrito nos
   * itens. Guardá-lo é o que permite ao OS refinar depois SABENDO do mesmo
   * ofício — sem isto, o primeiro ajuste voltaria a ser feito com o que o
   * modelo por acaso soubesse do papel, e o agente regrediria aos poucos.
   */
  playbookKey: z.string().trim().max(60).default(''),
  /**
   * Qual VERSÃO daquele ofício este agente já viu.
   *
   * O playbook evolui; o agente não muda sozinho por isso — publicação e
   * comportamento em produção não podem virar do avesso porque um admin editou
   * o piso. O número é o que torna a diferença VISÍVEL: sabendo que o agente
   * parou na v2 e o ofício está na v4, o produto consegue oferecer a
   * atualização, que roda pelo mesmo pipeline e passa pelo guard de regressão.
   */
  playbookVersion: z.number().int().min(0).default(0),
  canonicalSchemaVersion: z.literal(1),

  identity: z.object({
    name: z.string().min(1).max(80),
    /** Papel em uma linha: "Representante Comercial Estratégico". */
    role: z.string().max(160).default(''),
    archetype: z.string().max(80).optional(),
  }),

  objective: z.object({
    primary: z.string().max(600).default(''),
    secondary: z.array(z.string().max(300)).max(10).default([]),
  }),

  /**
   * Quem abre a conversa.
   *
   * É uma decisão de PRODUTO, não de estilo: um agente que espera ser abordado
   * e um que aborda primeiro precisam de comportamento, tom e estratégia
   * diferentes. Perguntar isso DEPOIS de criar o agente obrigaria a refazer
   * metade da configuração — por isso a pergunta vem antes, e o valor entra no
   * canônico junto com o resto.
   *
   * `opener` só é usado quando o agente inicia. Vazio, o runtime pede ao modelo
   * que abra segundo o restante da configuração; preenchido, é a fala exata.
   */
  engagement: z
    .object({
      initiator: z.enum(['USER', 'AGENT']).default('USER'),
      /**
       * A abertura é ROTEIRO ou DIRETRIZ?
       *
       * `SCRIPTED` — a fala é literal, sempre a mesma. Só quando o usuário
       *             QUER um texto fixo (um aviso legal, um script de callcenter).
       * `ADAPTIVE` — o agente formula a abertura na hora, seguindo `openerGuidance`
       *             e o resto da configuração. É o default, e é o caso comum.
       *
       * A separação existe porque um campo só não dava conta: o usuário dava um
       * EXEMPLO de tom e ele era gravado como a frase definitiva. Depois, ao
       * dizer "não pode ser fixa", a diretriz tomava o lugar da frase — e o
       * agente passava a abrir a conversa recitando a própria instrução.
       */
      openerMode: z.enum(['ADAPTIVE', 'SCRIPTED']).default('ADAPTIVE'),
      /** A fala literal. Usada verbatim SÓ em `SCRIPTED`. */
      opener: z.string().max(600).default(''),
      /**
       * Como abrir, quando é adaptativo — inclusive o exemplo que o usuário
       * deu. Exemplo é ILUSTRAÇÃO da propriedade, nunca a propriedade.
       */
      openerGuidance: z.string().max(800).default(''),
      /**
       * Liga/desliga de respostas recomendadas — o agente oferece opções
       * curtas de resposta quando fizer sentido estratégico, nunca em toda
       * mensagem. Recurso nativo do agente, apresentado na criação
       * (pergunta fixa no briefing) e editável depois pelo chat com o S.O,
       * mesmo padrão de `initiator`/`openerMode`.
       */
      suggestedRepliesEnabled: z.boolean().default(false),
      /**
       * Liga/desliga dos COMPONENTES VISUAIS no corpo da conversa: fluxo de
       * etapas, comparativo, ficha técnica, cartões de escolha. O agente decide
       * QUANDO usar cada um; isto decide se ele pode.
       *
       * O default é `false` aqui e `true` em `emptyAgent()`, e a assimetria é
       * deliberada. O schema é lido sobre documentos JÁ GRAVADOS, que não têm o
       * campo: um default `true` aqui faria TODO agente existente mudar de
       * comportamento sozinho, na próxima leitura, sem ninguém ter pedido — e
       * quem descobriria seria o cliente dele. `emptyAgent()` só corre na
       * criação, então agente NOVO nasce com o recurso e agente antigo espera
       * alguém ligar.
       */
      visualBlocksEnabled: z.boolean().default(false),
    })
    .default({
      initiator: 'USER',
      openerMode: 'ADAPTIVE',
      opener: '',
      openerGuidance: '',
      suggestedRepliesEnabled: false,
      visualBlocksEnabled: false,
    }),

  personality: z.array(canonicalItemSchema).max(20).default([]),
  communication: z.array(canonicalItemSchema).max(20).default([]),
  skills: z.array(canonicalItemSchema).max(30).default([]),
  behaviors: z.array(canonicalItemSchema).max(30).default([]),
  strategies: z.array(canonicalItemSchema).max(30).default([]),
  hardRules: z.array(canonicalItemSchema).max(30).default([]),
  limits: z.array(canonicalItemSchema).max(30).default([]),
});

export type CanonicalAgent = z.infer<typeof canonicalAgentV1Schema>;

export const AGENT_SCHEMAS: CanonicalSchemaSet<CanonicalAgent> = {
  latest: 1,
  schema: canonicalAgentV1Schema,
  migrations: [],
};

export function emptyAgent(name: string): CanonicalAgent {
  return {
    canonicalSchemaVersion: 1,
    playbookKey: '',
    playbookVersion: 0,
    identity: { name, role: '' },
    objective: { primary: '', secondary: [] },
    engagement: {
      initiator: 'USER',
      openerMode: 'ADAPTIVE',
      opener: '',
      openerGuidance: '',
      suggestedRepliesEnabled: false,
      // Agente NOVO nasce apresentando: ver a nota no schema sobre por que o
      // default daqui difere do de lá.
      visualBlocksEnabled: true,
    },
    personality: [],
    communication: [],
    skills: [],
    behaviors: [],
    strategies: [],
    hardRules: [],
    limits: [],
  };
}

export const AGENT_FACET_LABELS: Record<AgentFacet, string> = {
  personality: 'Personalidade',
  communication: 'Comunicação',
  skills: 'Skills',
  behaviors: 'Comportamentos',
  strategies: 'Estratégias',
  hardRules: 'Regras',
  limits: 'Limites',
};

/** Projeção humana do canônico. Derivada, nunca armazenada em paralelo. */
export function summarizeAgent(agent: CanonicalAgent): string[] {
  const lines: string[] = [];
  if (agent.identity.role) lines.push(`${agent.identity.name} — ${agent.identity.role}`);
  if (agent.objective.primary) lines.push(`Objetivo: ${agent.objective.primary}`);
  lines.push(
    agent.engagement.initiator === 'AGENT'
      ? 'Abre a conversa por conta própria.'
      : 'Responde quando abordado.',
  );

  for (const facet of Object.keys(AGENT_FACET_CODES) as AgentFacet[]) {
    for (const item of agent[facet]) {
      lines.push(`${item.code} · ${item.label}: ${item.statement}`);
    }
  }

  return lines;
}

/** Quantos itens o agente tem, somando todas as facetas. */
export function countAgentItems(agent: CanonicalAgent): number {
  return (Object.keys(AGENT_FACET_CODES) as AgentFacet[]).reduce(
    (total, facet) => total + agent[facet].length,
    0,
  );
}
