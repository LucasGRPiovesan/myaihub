import { z } from 'zod';
import type { MyAIHubOperation } from './operation.js';
import { intentField, describedField, narrativeField } from './output-intent.js';
import { ALL_PLAYBOOK_MUTATIONS, playbookMutationSchema } from './playbook-mutations.js';
import { BASE_POLICY_SECTIONS } from './policy-sections.js';

/**
 * Calibrar o playbook é uma operação do OS como qualquer outra.
 *
 * Ela existia como endpoint próprio, com caixa de texto própria dentro da tela
 * — e isso era o erro: no MyAIHub quem conversa com o OS é o PAINEL, sempre, em
 * todo escopo. Uma segunda porta significa segundo formato de saída, segundo
 * tratamento de erro, segundo lugar para esquecer de aplicar uma seção da
 * policy. Aqui ela passa pelo mesmo runner, com as mesmas mutações tipadas, o
 * mesmo versionamento e os mesmos eventos do painel vivo.
 *
 * O que é específico deste escopo: ele é de PLATAFORMA. O que se decide aqui
 * nasce dentro de todo agente daquele papel, em toda conta — por isso a
 * operação é do admin, e a instrução insiste em cirurgia.
 */
export const REFINE_PLAYBOOK: MyAIHubOperation = {
  name: 'playbook.refine',
  // Ajusta o que existe: sem alvo o runner criaria um novo (ver requiresTarget).
  requiresTarget: true,
  scope: 'PLAYBOOK',
  label: 'Calibrando o playbook',
  purpose:
    'Altera um playbook de ofício que já existe e responde sobre ele: princípios, limites e as perguntas do briefing daquele papel.',
  targetType: 'PLAYBOOK',
  steps: [
    { id: 'think', label: 'Lendo o playbook e localizando o que muda' },
    { id: 'persist', label: 'Salvando nova versão' },
  ],
  canonicalSchemaVersion: 1,
  allowedMutations: ALL_PLAYBOOK_MUTATIONS,
  outputSchema: z.object({
    ...intentField,
    interpretedIntent: describedField(300),
    rationale: z.string().trim().min(3).max(2000),
    humanSummary: narrativeField(6000),
    mutations: z.array(playbookMutationSchema).max(20),
    conflicts: z
      .array(
        z.object({ itemCode: z.string().max(10).optional(), description: z.string().max(400) }),
      )
      .max(10)
      .default([]),
    gaps: z.array(z.string().max(300)).max(10).default([]),
  }),
  policySections: [
    ...BASE_POLICY_SECTIONS,
    'calibration_level',
    'deduplication',
    'craft',
    'agent_taxonomy',
  ],
  contextRequirements: [{ key: 'playbook.current', priority: 88, cacheable: true, required: true }],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 30_000,
  instruction: [
    'O admin da plataforma quer calibrar um PLAYBOOK DE OFÍCIO. O playbook atual',
    'está no contexto, com o código e a chave semântica de cada item.',
    '',
    'O playbook é a baseline profissional de um papel: cada princípio vira um item',
    'na configuração de TODO agente daquele tipo, na faceta declarada; cada limite',
    'vira uma proibição; cada pergunta é o que o sistema pergunta a quem cria o',
    'agente. Não é um documento de leitura — é configuração executável.',
    '',
    'VOCÊ NÃO REESCREVE O DOCUMENTO.',
    '',
    'Devolva APENAS as mutações necessárias. O que o pedido não menciona não entra',
    'na sua resposta e fica exatamente como está. Mexer em mais de uma seção no',
    'mesmo pedido é normal: "ele insiste demais depois do não" costuma pedir um',
    'princípio mais forte E um limite novo.',
    '',
    'REFINAR É REUTILIZAR A `semanticKey`. Para melhorar um item que já existe,',
    'mande UPSERT com a MESMA chave: ele é substituído no lugar, mantendo código e',
    'posição. Chave nova cria item novo — e dois itens dizendo a mesma coisa viram',
    'configuração contraditória no primeiro ajuste seguinte.',
    '',
    'REFINAR É AUMENTAR PRECISÃO, NÃO ENCURTAR. O `statement` novo precisa ser mais',
    'específico que o anterior. Trocar instrução detalhada por adjetivo é regressão,',
    'mesmo parecendo mais limpo.',
    '',
    'Cada `statement` é INSTRUÇÃO acionável em terceira pessoa, com o motivo',
    'embutido quando ele muda o comportamento — nunca um rótulo. "Seja consultivo"',
    'não configura nada; "investiga a situação e as implicações do problema antes',
    'de apresentar qualquer solução" configura.',
    '',
    'A FACETA define em que parte da configuração o item nasce, e o número de itens',
    'por faceta vira o ALVO que a criação de agente persegue. Mover um princípio de',
    'faceta muda esse alvo: faça quando for certo, e diga no `humanSummary`.',
    '',
    'Pergunta do briefing (`UPSERT_QUESTION`) só entra se for FATO que apenas quem',
    'opera o negócio sabe E que continue valendo em QUALQUER campanha daquele',
    'agente. Produto, preço, público e desconto são da campanha — ver a seção',
    '"information_level".',
  ].join('\n'),
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'Toda mutação responde a algo que o admin PEDIU? Item que ele não mencionou não',
    'deveria aparecer na sua resposta. Ao refinar, você reutilizou a `semanticKey`',
    'que já existe? O `humanSummary` diz o que você ENCONTROU e o que fez — não',
    'apenas "atualizei o playbook"?',
    '',
  ].join('\n'),
};

/**
 * `playbook.create` — o OS escreve o ofício que ele mesmo detectou faltar.
 *
 * O sistema já sabia da lacuna: papel que não casa com playbook nenhum vira
 * `PlaybookMiss`, e a pauta do admin ordena por frequência. O que faltava era o
 * OS poder FECHAR essa lacuna — até aqui ele registrava e esperava alguém
 * escrever o ofício à mão, enquanto todo agente daquele papel continuava
 * nascendo genérico.
 *
 * Registrar o próprio limite e esperar um humano é o oposto do que este produto
 * promete: quem administra intenção é o usuário; a implementação é do OS.
 *
 * A curadoria NÃO some — ela muda de lugar. O admin passa a revisar um rascunho
 * real, com histórico e versão, em vez de partir de uma folha em branco; e
 * `playbook.refine` continua sendo como se corrige o que ficou errado.
 *
 * A IDENTIDADE é campo de topo, e PRIMEIRO. Enterrada no array de mutações ela
 * era omitida — foi o que já custou `identity` e `objective` na criação de
 * agente. Aqui é pior: sem `key` o ofício não tem como ser gravado.
 */
export const createPlaybookOutputSchema = z.object({
  identity: z.object({
    /**
     * A chave é ESTÁVEL e vira o endereço do ofício. Mesma forma do resto do
     * canônico: minúsculas e ponto, `familia.especialidade`.
     */
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
      .max(60),
    label: z.string().trim().min(3).max(80),
    thesis: z.string().trim().min(20).max(600),
    /** Como o classificador reconhece o papel. Frase, não palavra-chave. */
    appliesTo: z.array(z.string().trim().min(3).max(120)).min(1).max(12),
  }),
  ...intentField,
  interpretedIntent: describedField(300),
  rationale: z.string().trim().min(3).max(2000),
  humanSummary: narrativeField(6000),
  mutations: z.array(playbookMutationSchema).max(40),
  conflicts: z
    .array(z.object({ itemCode: z.string().max(10).optional(), description: z.string().max(400) }))
    .max(10)
    .default([]),
  gaps: z.array(z.string().max(300)).max(10).default([]),
});

export const CREATE_PLAYBOOK: MyAIHubOperation = {
  name: 'playbook.create',
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    '`identity` tem `key`, `label`, `thesis` e `appliesTo` — sem `key` o ofício não',
    'tem endereço e não pode ser gravado.',
    '',
    'Ao menos 6 princípios, com a FACETA declarada em cada um, e ao menos 3 limites.',
    'Ofício com três princípios genéricos não muda o piso de agente nenhum — e é',
    'para mudar o piso que ele existe.',
    '',
    'Princípio é PRESCRITIVO e concreto: o que se faz, quando, e o que se faz no',
    'lugar quando não dá. Adjetivo ("atendimento de qualidade") não instrui ninguém.',
    '',
  ].join('\n'),
  scope: 'PLAYBOOK',
  label: 'Escrevendo o ofício',
  purpose: 'Escreve um PLAYBOOK de ofício novo, para um papel que ainda não tem nenhum.',
  targetType: 'PLAYBOOK',
  steps: [
    { id: 'think', label: 'Lendo a pauta e o que o ofício exige' },
    { id: 'write', label: 'Escrevendo princípios, limites e perguntas' },
    { id: 'persist', label: 'Salvando a primeira versão' },
  ],
  canonicalSchemaVersion: 1,
  allowedMutations: ALL_PLAYBOOK_MUTATIONS,
  requiredMutations: ['UPSERT_PRINCIPLE'],
  outputSchema: createPlaybookOutputSchema,
  policySections: [...BASE_POLICY_SECTIONS, 'craft', 'agent_taxonomy', 'deduplication'],
  // Sem `contextRequirements`: o alvo não existe ainda. O que orienta é a PAUTA,
  // que o alvo publica como contexto relacionado.
  contextRequirements: [],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 20_000,
  instruction: [
    'Você está ESCREVENDO um ofício que ainda não existe.',
    '',
    'Ofício é o que faz alguém ser BOM naquele papel: o que um profissional',
    'experiente faz sem pensar, e o que ele nunca faz. Não é o negócio de nenhum',
    'cliente — preço, produto e região são fato do negócio e não entram aqui.',
    '',
    'Este playbook vira o PISO de todo agente daquele papel, em toda conta. Por',
    'isso ele precisa ser específico o bastante para mudar comportamento: se os',
    'princípios servem igualmente para um vendedor e para um recepcionista, você',
    'escreveu conduta genérica, e conduta genérica já existe em `core.conduct`.',
    '',
    'Declare a FACETA de cada princípio. Ela não é burocracia: é o que faz o',
    'projetista do agente distribuir os itens em vez de parar na cobertura mínima.',
    '',
    'As PERGUNTAS do briefing são as que só o dono do negócio pode responder',
    'naquele papel. O que o ofício já sabe responder vai em `alreadyAnswered` — e',
    'perguntar o que o ofício já sabe devolve ao usuário o trabalho que ele veio',
    'delegar.',
    '',
    'A PAUTA está no contexto: são os papéis que chegaram sem ofício, por',
    'frequência. Se o usuário não disse qual escrever, escolha o mais frequente e',
    'diga por que escolheu.',
  ].join('\n'),
};
