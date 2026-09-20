import { z } from 'zod';
import {
  campaignMutationSchema,
  type CampaignMutationKind,
} from '../../campaigns/domain/mutations.js';
import type { MyAIHubOperation } from './operation.js';
import { intentField, describedField, narrativeField } from './output-intent.js';
import { BASE_POLICY_SECTIONS } from './policy-sections.js';
import { describeRuleChecksForPrompt } from './rule-checks.js';

/**
 * Operações do OS sobre a Campaign Strategy (§17, Fase 7).
 *
 * A campanha é o terceiro `OperationTarget` — o runner não abre exceção para
 * ela. O que é específico da campanha e não existia antes: ela nasce DENTRO de
 * um projeto (`scopeIdRole: 'PARENT'`) e é executada por um agente vinculado,
 * que precisa estar no contexto para a estratégia não ser genérica.
 */

const campaignOutputBase = {
  ...intentField,
  interpretedIntent: describedField(300),
  rationale: z.string().trim().min(3).max(2000),
  humanSummary: narrativeField(6000),
  mutations: z.array(campaignMutationSchema).max(40),
  conflicts: z
    .array(z.object({ itemCode: z.string().max(10).optional(), description: z.string().max(400) }))
    .max(10)
    .default([]),
  gaps: z.array(z.string().max(300)).max(10).default([]),
};

export const createCampaignOutputSchema = z.object({
  /**
   * Campo de topo obrigatório, e PRIMEIRO na ordem.
   *
   * Enterrado no array de mutações o modelo omitia; colocado depois dele no
   * schema, também — porque a geração degrada no fim. O curto e obrigatório vem
   * antes do longo.
   */
  identity: z.object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(400),
  }),
  objective: z.string().trim().min(1).max(600),
  ...campaignOutputBase,
});

export const configureCampaignOutputSchema = z.object(campaignOutputBase);

const ALL_CAMPAIGN_MUTATIONS: readonly CampaignMutationKind[] = [
  'SET_CAMPAIGN_IDENTITY',
  'SET_CAMPAIGN_GOAL',
  'UPSERT_AUDIENCE_SEGMENT',
  'UPSERT_DISCOVERY_DIMENSION',
  'UPSERT_CAMPAIGN_STRATEGY',
  'UPSERT_CONVERSION_BEHAVIOR',
  'UPSERT_KNOWLEDGE_SCOPE',
  'UPSERT_CAMPAIGN_RULE',
];

const CAMPAIGN_POLICY_SECTIONS = [
  ...BASE_POLICY_SECTIONS,
  'baseline_conduct',
  'deduplication',
  'craft',
  'campaign_strategy',
  'advisory',
] as const;

/**
 * O que separa campanha de agente, na instrução.
 *
 * Sem isto o modelo escreve personalidade e tom de voz na campanha — que é onde
 * eles NÃO moram. O Agent Core já tem essas facetas, e duplicá-las criaria duas
 * fontes de verdade que divergem no primeiro ajuste.
 */
const SCOPE_GUIDANCE = [
  'A campanha NÃO redefine o agente. Ela ESPECIALIZA a atuação dele aqui.',
  '',
  'NÃO escreva personalidade, tom de voz ou forma de comunicar: isso é Agent Core,',
  'ajustado em outro lugar. Se o usuário pedir isso, registre em `gaps` dizendo que',
  'o ajuste é no agente.',
  '',
  'O que É da campanha:',
  '- `UPSERT_AUDIENCE_SEGMENT`: com quem esta campanha fala.',
  '- `UPSERT_DISCOVERY_DIMENSION`: o que o agente precisa DESCOBRIR antes de propor.',
  '  É o coração da campanha — sem isso o agente empurra oferta sem entender ninguém.',
  '- `UPSERT_CAMPAIGN_STRATEGY`: como conduzir a conversa até lá.',
  '- `UPSERT_CONVERSION_BEHAVIOR`: o que fazer quando a pessoa está pronta.',
  '- `UPSERT_KNOWLEDGE_SCOPE`: que assuntos do projeto entram e quais ficam de fora.',
  '- `UPSERT_CAMPAIGN_RULE`: obrigações e proibições válidas SÓ nesta campanha.',
].join('\n');

const CHECK_GUIDANCE = [
  'Quando a regra for mecanicamente verificável, use `enforcement: "DETERMINISTIC"`',
  'e preencha `check` com um destes — e SOMENTE com um destes:',
  describeRuleChecksForPrompt(),
  '',
  'Não invente nome de checker. Regra sem checker correspondente é "HARD" quando',
  'é obrigação inegociável, e "SOFT" quando é preferência.',
].join('\n');

export const CREATE_CAMPAIGN: MyAIHubOperation = {
  name: 'campaign.create',
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    '`identity.name`, `identity.summary` e `objective` são OBRIGATÓRIOS e vêm',
    'ANTES das mutações. Uma campanha sem nome nem objetivo não é uma campanha',
    'incompleta: é uma saída recusada, depois da geração inteira já paga.',
    '',
  ].join('\n'),
  scope: 'PROJECT',
  // O id da conversa é o do PROJETO: a campanha ainda não existe.
  scopeIdRole: 'PARENT',
  label: 'Criando a campanha',
  purpose:
    'Cria uma CAMPANHA nova dentro deste projeto, a partir do objetivo e do público que o usuário descrever.',
  targetType: 'CAMPAIGN',
  steps: [
    { id: 'think', label: 'Interpretando o objetivo e estruturando' },
    { id: 'persist', label: 'Salvando e versionando' },
  ],
  canonicalSchemaVersion: 1,
  // `SET_CAMPAIGN_HERO_IMAGE` não é para o MODELO propor — nenhuma instrução
  // menciona — é o runner que injeta essa mutação, determinística, quando a
  // mensagem de criação trouxe exatamente uma imagem. Precisa estar aqui para
  // não ser barrada como "fora do escopo desta operação" (ver mutation-applier).
  allowedMutations: [...ALL_CAMPAIGN_MUTATIONS, 'SET_CAMPAIGN_CTA', 'SET_CAMPAIGN_HERO_IMAGE'],
  outputSchema: createCampaignOutputSchema,
  policySections: CAMPAIGN_POLICY_SECTIONS,
  // O perfil do projeto é obrigatório: uma campanha que não conhece o negócio
  // seria uma estratégia genérica com nome bonito.
  contextRequirements: [{ key: 'project.profile', priority: 90, cacheable: true, required: true }],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 16_000,
  instruction: [
    'O usuário está criando uma CAMPANHA dentro de um projeto. O perfil do projeto',
    'está no contexto — a campanha precisa fazer sentido para ESTE negócio.',
    '',
    '`identity.name` é o nome da campanha; `identity.summary` diz em uma linha o que',
    'ela faz. `objective` é o resultado que ela persegue.',
    '',
    'Não repita identidade nem objetivo em `mutations` — eles já vão nos campos de topo.',
    '',
    SCOPE_GUIDANCE,
    '',
    'Se o usuário descreveu pouco, NÃO invente público nem estratégia: registre em',
    '`gaps` o que falta perguntar.',
    '',
    CHECK_GUIDANCE,
  ].join('\n'),
};

export const REFINE_CAMPAIGN_STRATEGY: MyAIHubOperation = {
  name: 'campaign.refine_strategy',
  // Ajusta o que existe: sem alvo o runner criaria um novo (ver requiresTarget).
  requiresTarget: true,
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'A estratégia atual é o PISO: nenhum item some sem pedido explícito de',
    'remoção, e nenhum `statement` fica mais curto do que já era.',
    '',
  ].join('\n'),
  scope: 'CAMPAIGN',
  label: 'Ajustando a estratégia',
  purpose:
    'Altera uma campanha que já existe: objetivo, público, o que descobrir antes de propor, como o agente conduz ESTA ação (abertura por produto, ritmo, perguntas), o que fazer quando a pessoa está pronta e regras só dela.',
  targetType: 'CAMPAIGN',
  steps: [
    { id: 'think', label: 'Interpretando o pedido e ajustando' },
    { id: 'persist', label: 'Salvando nova versão' },
  ],
  canonicalSchemaVersion: 1,
  allowedMutations: [...ALL_CAMPAIGN_MUTATIONS, 'REMOVE_CAMPAIGN_ITEM'],
  outputSchema: configureCampaignOutputSchema,
  policySections: CAMPAIGN_POLICY_SECTIONS,
  contextRequirements: [
    { key: 'campaign.strategy', priority: 88, cacheable: true, required: true },
    { key: 'project.profile', priority: 80, cacheable: true, required: true },
  ],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 20_000,
  instruction: [
    'O usuário quer ajustar a estratégia de uma campanha existente. A estratégia',
    'atual, o perfil do projeto e o agente vinculado estão no contexto.',
    '',
    'Antes de criar item novo, procure um que já expresse a MESMA ideia e REFINE-O',
    'reutilizando o mesmo `semanticKey`.',
    '',
    SCOPE_GUIDANCE,
    '',
    'Só remova item se o usuário pediu explicitamente.',
    '',
    CHECK_GUIDANCE,
  ].join('\n'),
};

/**
 * CTA em operação separada, com `allowedMutations` de UM item.
 *
 * É a demonstração mais direta do §7.2: por mais que o modelo proponha mexer no
 * público ou nas regras enquanto configura o botão, o domínio recusa.
 */
export const CONFIGURE_CAMPAIGN_CTA: MyAIHubOperation = {
  name: 'campaign.configure_cta',
  // Ajusta o que existe: sem alvo o runner criaria um novo (ver requiresTarget).
  requiresTarget: true,
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'Esta operação EXIGE uma mutação `SET_CAMPAIGN_CTA`. Sem ela a resposta não',
    'faz nada, e o usuário fica com a impressão contrária.',
    '',
    'Não invente URL, telefone nem horário: dado de contato que o usuário não',
    'deu vira pergunta, nunca preenchimento plausível.',
    '',
  ].join('\n'),
  scope: 'CAMPAIGN',
  label: 'Configurando a chamada para ação',
  purpose: 'Define a CTA da campanha — o que ela oferece ao final e para onde manda a pessoa.',
  targetType: 'CAMPAIGN',
  steps: [
    { id: 'think', label: 'Interpretando o pedido e definindo o CTA' },
    { id: 'persist', label: 'Salvando nova versão' },
  ],
  canonicalSchemaVersion: 1,
  allowedMutations: ['SET_CAMPAIGN_CTA'],
  requiredMutations: ['SET_CAMPAIGN_CTA'],
  outputSchema: configureCampaignOutputSchema,
  policySections: [...BASE_POLICY_SECTIONS, 'campaign_strategy'],
  contextRequirements: [
    { key: 'campaign.strategy', priority: 88, cacheable: true, required: true },
  ],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 10_000,
  instruction: [
    'O usuário está configurando a CHAMADA PARA AÇÃO da campanha.',
    '',
    'Use apenas `SET_CAMPAIGN_CTA`. `label` é o texto do botão, `url` o destino, e',
    '`condition` descreve QUANDO o agente deve oferecê-lo — em linguagem natural,',
    'porque é o agente que julga se a conversa chegou lá.',
    '',
    'Se o usuário não informou um link, deixe `enabled: false` e registre em `gaps`',
    'que o destino está faltando. Um CTA ativo sem destino é um botão quebrado.',
  ].join('\n'),
};
