import { z } from 'zod';
import { canonicalItemSchema } from './item.js';
import type { CanonicalSchemaSet } from './migrate.js';

/**
 * Project Profile canônico (§13).
 *
 * As facetas em lista usam CanonicalItem para que o OS possa mutá-las por
 * `semanticKey` — sem isso, cada refinamento do usuário criaria um item novo
 * em vez de refinar o existente.
 */

export const PROJECT_TYPES = [
  'saas',
  'ecommerce',
  'site',
  'sistema',
  'empresa',
  'produto',
  'servico',
  'outro',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/**
 * Prefixos de `code` por faceta.
 *
 * A ORDEM aqui é a ordem de leitura do perfil, e ela conta uma história: para
 * quem o negócio existe, o que oferece, por que escolheriam isso, o que o
 * distingue, contra quem disputa, e sob quais regras opera.
 *
 * `market` e `businessRules` entraram na v2 porque o usuário chega ao OS com
 * exatamente essas duas coisas — análise de mercado e, principalmente, regra de
 * negócio — e elas não tinham onde morar. O que não tem seção vira `summary`
 * inchado ou `gaps`: em ambos os casos o agente nunca recebe.
 */
export const PROJECT_FACET_CODES = {
  audiences: 'AU',
  offerings: 'OF',
  valuePropositions: 'VP',
  differentiators: 'DF',
  market: 'MK',
  businessRules: 'BR',
} as const;

export type ProjectFacet = keyof typeof PROJECT_FACET_CODES;

/**
 * Vocabulário de `semanticKey` por faceta.
 *
 * Controlado de propósito: chave livre transformaria o canônico num EAV
 * disfarçado, que é exatamente o que o §5.4 proíbe. Ampliar o vocabulário é
 * uma mudança de código, revisada — não um efeito colateral de um prompt.
 */
export const PROJECT_SEMANTIC_KEY_PREFIXES: Record<ProjectFacet, string> = {
  audiences: 'audience',
  offerings: 'offering',
  valuePropositions: 'value_proposition',
  differentiators: 'differentiator',
  market: 'market',
  businessRules: 'business_rule',
};

/**
 * Mutação que altera cada faceta, e a que remove item.
 *
 * Vive no pacote compartilhado porque a EDIÇÃO MANUAL do painel monta as mesmas
 * mutações tipadas que o modelo monta (§7.2). Duplicar estes nomes no frontend
 * criaria um vocabulário paralelo que erra em silêncio: o backend rejeitaria a
 * mutação e a tela diria "salvo".
 */
export const PROJECT_FACET_MUTATION: Record<ProjectFacet, string> = {
  audiences: 'UPSERT_AUDIENCE',
  offerings: 'UPSERT_OFFERING',
  valuePropositions: 'UPSERT_VALUE_PROPOSITION',
  differentiators: 'UPSERT_DIFFERENTIATOR',
  market: 'UPSERT_MARKET_INSIGHT',
  businessRules: 'UPSERT_BUSINESS_RULE',
};

export const PROJECT_REMOVE_MUTATION = 'REMOVE_ITEM';

export const PROJECT_FACET_LABELS: Record<ProjectFacet, string> = {
  audiences: 'Públicos',
  offerings: 'Ofertas',
  valuePropositions: 'Proposta de valor',
  differentiators: 'Diferenciais',
  market: 'Mercado',
  businessRules: 'Regras de negócio',
};

/**
 * Slug de rota por faceta — mesma solução das facetas do agente.
 *
 * O perfil virou seis seções, e seis seções numa página só é a rolagem de dois
 * mil pixels que já foi um erro aqui uma vez. Cada faceta é uma ROTA, com nível
 * na sidebar: é o que faz a tela dizer onde você está.
 */
export const PROJECT_FACET_SLUGS: Record<ProjectFacet, string> = {
  audiences: 'publicos',
  offerings: 'ofertas',
  valuePropositions: 'proposta-de-valor',
  differentiators: 'diferenciais',
  market: 'mercado',
  businessRules: 'regras-de-negocio',
};

/** `null` quando o slug não corresponde a faceta nenhuma. */
export function projectFacetFromSlug(slug: string): ProjectFacet | null {
  const entry = Object.entries(PROJECT_FACET_SLUGS).find(([, value]) => value === slug);
  return entry ? (entry[0] as ProjectFacet) : null;
}

/** O que cada faceta responde. Explica a seção na tela e orienta o roteamento. */
export const PROJECT_FACET_DESCRIPTIONS: Record<ProjectFacet, string> = {
  audiences: 'Para quem o negócio existe.',
  offerings: 'O que ele oferece, com o detalhe que o interlocutor precisa ouvir.',
  valuePropositions: 'Por que alguém escolheria isto.',
  differentiators: 'O que o distingue de quem faz parecido.',
  market: 'Concorrência, posicionamento, sazonalidade e o que move a decisão de compra.',
  businessRules:
    'O que pode e o que não pode ser dito, prometido ou combinado em nome do negócio. ' +
    'Regra marcada como obrigatória vira regra inegociável de todo agente do projeto.',
};

/**
 * A faceta cujos itens ATRAVESSAM para o agente como regra vinculante.
 *
 * É a única do perfil com efeito direto sobre o runtime: uma regra de negócio
 * HARD entra no bloco `REGRAS INEGOCIÁVEIS` do prompt de todo agente que atua
 * neste projeto. As outras facetas informam; esta obriga.
 */
export const PROJECT_BINDING_FACET: ProjectFacet = 'businessRules';

const projectItemSchema = canonicalItemSchema;

export const canonicalProjectProfileV2Schema = z.object({
  canonicalSchemaVersion: z.literal(2),
  name: z.string().min(1).max(120),
  type: z.enum(PROJECT_TYPES),
  // Sem mínimo: um perfil em construção legitimamente ainda não tem resumo.
  // Exigir conteúdo aqui tornaria o documento inicial inválido contra o próprio
  // schema, o que quebra a leitura antes mesmo da primeira mutação.
  summary: z.string().max(2000).default(''),
  business: z.object({
    model: z.string().max(200).optional(),
    stage: z.string().max(120).optional(),
  }),
  audiences: z.array(projectItemSchema).max(30).default([]),
  offerings: z.array(projectItemSchema).max(30).default([]),
  valuePropositions: z.array(projectItemSchema).max(30).default([]),
  differentiators: z.array(projectItemSchema).max(30).default([]),
  market: z.array(projectItemSchema).max(30).default([]),
  // Teto maior que o das outras: regra de negócio é o que o usuário mais tem a
  // dizer sobre o próprio negócio, e cortar em 30 obrigaria a escolher qual
  // regra o agente pode quebrar.
  businessRules: z.array(projectItemSchema).max(60).default([]),
});

export type CanonicalProjectProfile = z.infer<typeof canonicalProjectProfileV2Schema>;

export const PROJECT_PROFILE_SCHEMAS: CanonicalSchemaSet<CanonicalProjectProfile> = {
  latest: 2,
  schema: canonicalProjectProfileV2Schema,
  migrations: [
    {
      from: 1,
      to: 2,
      // Aditiva: nenhum perfil da v1 tinha onde guardar mercado ou regra de
      // negócio, então as duas facetas nascem vazias. O documento gravado não é
      // reescrito — a migração roda na LEITURA (§5.3).
      migrate: (document) => ({ ...document, market: [], businessRules: [] }),
    },
  ],
};

/** Documento inicial de um projeto recém-criado. */
export function emptyProjectProfile(name: string): CanonicalProjectProfile {
  return {
    canonicalSchemaVersion: 2,
    name,
    type: 'outro',
    summary: '',
    business: {},
    audiences: [],
    offerings: [],
    valuePropositions: [],
    differentiators: [],
    market: [],
    businessRules: [],
  };
}

/**
 * Resumo humano derivado do canônico.
 *
 * É o que a UI mostra — a verdade continua no documento canônico. Derivar em
 * vez de armazenar evita que os dois divirjam com o tempo.
 */
export function summarizeProjectProfile(profile: CanonicalProjectProfile): string[] {
  const lines: string[] = [];
  if (profile.summary) lines.push(profile.summary);

  for (const [facet, prefix] of Object.entries(PROJECT_FACET_CODES) as Array<
    [ProjectFacet, string]
  >) {
    for (const item of profile[facet]) {
      lines.push(`${item.code ?? prefix} · ${item.label}: ${item.statement}`);
    }
  }

  return lines;
}

/** Quantos itens o perfil tem, por faceta. Usado pelo console do painel. */
export function countProjectItems(profile: CanonicalProjectProfile): Record<ProjectFacet, number> {
  const counts = {} as Record<ProjectFacet, number>;
  for (const facet of Object.keys(PROJECT_FACET_CODES) as ProjectFacet[]) {
    counts[facet] = profile[facet].length;
  }
  return counts;
}
