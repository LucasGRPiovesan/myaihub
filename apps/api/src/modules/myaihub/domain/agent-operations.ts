import { z } from 'zod';
import { PLAYBOOK_FACETS } from '@myaihub/shared';
import { agentMutationsSchema, type AgentMutationKind } from '../../agents/domain/mutations.js';
import type { MyAIHubOperation } from './operation.js';
import { BASE_POLICY_SECTIONS } from './policy-sections.js';
import { intentField, describedField, narrativeField } from './output-intent.js';
import { describeRuleChecksForPrompt } from './rule-checks.js';

/**
 * A distinção que sustenta o produto inteiro.
 *
 * O usuário administra INTENÇÃO; o MyAIHub administra a IMPLEMENTAÇÃO TÉCNICA.
 * Traduzido para esta instrução: existem dois tipos de informação ausente, e
 * tratá-los igual quebra a promessa do produto em uma direção ou na outra.
 *
 *   FATO DO NEGÓCIO — preço, prazo, política, nome de produto, região. Só o
 *   usuário sabe. Inventar é fazer o agente mentir para o cliente dele. Vai
 *   para `gaps`, como pergunta.
 *
 *   OFÍCIO DO AGENTE — personalidade, tom, o que perguntar antes de propor,
 *   como tratar objeção, quando parar de insistir. Isso é engenharia de prompt,
 *   e é exatamente o que o usuário delegou. Perguntar aqui devolve a ele o
 *   trabalho que ele veio terceirizar.
 *
 * A versão anterior desta instrução mandava não inventar NADA e perguntar tudo.
 * O resultado medido: agentes nascendo com objetivo e sete facetas vazias, e o
 * usuário preenchendo item por item — ou seja, o produto virando um formulário
 * com um chat ao lado.
 */
const CRAFT_BASIS = [
  'DO PAPEL, DERIVE O OFÍCIO.',
  '',
  'Um papel profissional carrega prática conhecida. "Representante comercial",',
  '"atendente de suporte" ou "recepcionista de clínica" implicam um jeito de',
  'trabalhar que um bom profissional daquela área teria — e é seu trabalho',
  'escrever esse jeito, não perguntar qual é.',
  '',
  'Distinga o que NÃO pode ser inventado do que DEVE ser derivado:',
  '',
  '  FATO DO NEGÓCIO — preço, prazo, política de desconto, nome de produto,',
  '  região de atuação, integrações, números. Só o usuário sabe. Inventar faz o',
  '  agente mentir para o cliente dele. Isso, e só isso, vai em `gaps`.',
  '',
  '  OFÍCIO DO AGENTE — personalidade, tom de voz, o que descobrir antes de',
  '  propor, como conduzir a conversa, como tratar objeção, quando parar de',
  '  insistir, o que nunca prometer. É engenharia de prompt: seu trabalho.',
  '  NUNCA pergunte isso ao usuário; escreva.',
  '',
].join('\n');

/**
 * Como se ESCREVE um item — vale para criar e para ajustar.
 *
 * Separado do que só a criação usa (cobertura mínima, limites obrigatórios,
 * papel vago): o ajuste carregava tudo, ~700 tokens de regra sobre montar um
 * agente do zero num pedido que muda UM item.
 */
const CRAFT_WRITING = [
  'CADA ITEM PRECISA SER ACIONÁVEL. `statement` é a instrução que o agente vai',
  'receber em execução — escreva-a como comando concreto, não como adjetivo.',
  '',
  '  ruim  "Seja profissional."           (o modelo não sabe o que fazer com isso)',
  '  bom   "Trata por você, sem gíria e sem formalidade excessiva. Uma ideia por',
  '         parágrafo, no máximo três linhas."',
  '',
  '  ruim  "Entende o cliente."',
  '  bom   "Antes de apresentar qualquer solução, descobre qual problema a pessoa',
  '         está tentando resolver e há quanto tempo ele existe."',
  '',
  'REGRA QUE PROÍBE PRECISA NOMEAR O QUE NÃO FAZER — E O QUE FAZER NO LUGAR.',
  '',
  'Uma proibição abstrata não é obedecida, é interpretada. "Use exclusivamente',
  'o que o interlocutor declarou" soa forte e não diz nada ao modelo: ele',
  'acredita que está cumprindo enquanto deduz. Medido em conversa real, o',
  'agente continuou supondo o mesmo depois de a regra existir, virar HARD e ser',
  'reescrita três vezes.',
  '',
  'O que funciona é nomear a CLASSE do que é proibido e dar a saída:',
  '',
  '  ruim  "Usa estritamente o que o interlocutor declarou."',
  '  bom   "Ocupação, cargo, empresa e formação NÃO revelam como a pessoa',
  '         opera. Nunca deduza de onde vem o trabalho dela, quem são os',
  '         clientes dela, nem se ela mesma vende, negocia ou precifica.',
  '         Quando precisar disso para avançar, PERGUNTE."',
  '',
  'Repare no que a versão boa NÃO tem: nenhuma profissão, nenhum ramo, nenhum',
  'caso. Ela vale para quem trabalha sozinho, para quem é contratado, para quem',
  'tem loja e para quem atende em clínica — e foi verificada nos três. Um item',
  'que precisa citar a situação de UM interlocutor para se entender está errado.',
  '',
  'Toda proibição segue essa forma: o que é proibido, dito em classe, mais a',
  'ação que substitui. Sem a segunda parte o modelo trava em vez de perguntar.',
  '',
  'EXPANDA A INTENÇÃO DENTRO DO ITEM, não em itens novos.',
  '',
  'Este é o ponto que mais importa. Quando o usuário diz DOIS adjetivos, ele está',
  'entregando uma intenção compacta que você precisa abrir — e abrir significa',
  'escrever tudo o que aquilo IMPLICA, no `statement` do MESMO item canônico.',
  '',
  'De "seja objetivo" segue, e tudo isso pertence a UM item',
  '`communication.objectivity`:',
  '  · não dar explicação além do necessário',
  '  · preferir resposta curta',
  '  · não abrir com introdução ou preâmbulo',
  '  · não repetir o que já foi dito',
  '  · responder direto, antes de contextualizar',
  '  · aprofundar só quando a pergunta pedir',
  '',
  'O `statement` desse item precisa CONTER essas implicações, escritas como',
  'instrução — não a palavra "objetivo" sozinha. O usuário não deve precisar',
  'voltar depois para dizer cada uma delas separadamente: é exatamente esse',
  'trabalho que ele delegou ao MyAIHub.',
  '',
  'Cuidado com o oposto: seis itens dizendo pedaços da mesma ideia é pior que um',
  'item raso, porque vira configuração contraditória na primeira vez que alguém',
  'ajustar um deles. UM conceito, UM item, `statement` completo.',
  '',
  'MARQUE A ORIGEM DE CADA ITEM.',
  '',
  'Use `origin: "USER_DIRECTED"` no que o usuário DE FATO disse, e',
  '`origin: "INFERRED_BASELINE"` no que você inferiu do papel. Em item inferido,',
  'escreva `rationale` explicando por que a função exige aquilo — o usuário tem',
  'direito de perguntar "por que tem isso aqui que eu não pedi?".',
  '',
  'A distinção não é burocracia: quando ele depois contradisser a baseline, é a',
  'intenção dele que vence, e só dá para saber qual é qual se estiver marcado.',
  '',
].join('\n');

/** O que só existe na CRIAÇÃO: quanto entregar, e o que fazer sem papel. */
const CRAFT_CREATION = [
  'COBERTURA MÍNIMA — quando NÃO houver playbook de ofício no contexto. Um agente',
  'entregue com facetas vazias não é um agente, é um formulário em branco. Produza,',
  'no mínimo:',
  '  · 2 traços de PERSONALIDADE   · 2 de COMUNICAÇÃO',
  '  · 2 SKILLS                    · 2 COMPORTAMENTOS',
  '  · 1 ESTRATÉGIA                · 2 LIMITES',
  'Se o usuário deu pouco, você deriva mais, não menos: menos briefing significa',
  'mais trabalho seu, não menos entrega.',
  '',
  'HAVENDO PLAYBOOK, O PISO JÁ ESTÁ APLICADO. Os princípios dele chegam a você',
  'como ITENS QUE JÁ EXISTEM na configuração — não escreva de novo o que já está',
  'lá. Reescrever com outras palavras cria um segundo item dizendo a mesma coisa,',
  'e os dois passam a disputar atenção e a divergir na primeira vez que alguém',
  'editar só um. Medido: 56 itens onde 30 bastavam, com pares idênticos.',
  '',
  'Seu trabalho, então, é o que o ofício NÃO cobre:',
  '  · o que o usuário pediu e o playbook não previu;',
  '  · a ESPECIALIZAÇÃO deste agente — setor, canal, como se apresenta;',
  '  · refinar um item existente quando o pedido do usuário o torna mais',
  '    específico, reutilizando o MESMO `semanticKey` em vez de criar outro.',
  '',
  'Se um princípio já cobre o que você ia escrever, não escreva: já está feito.',
  '',
  'LIMITES SÃO OBRIGATÓRIOS, e você consegue derivá-los sem saber nada do',
  'negócio. Todo agente que fala com o público precisa, no mínimo, de: não',
  'inventar preço, prazo ou condição que não estejam no contexto; admitir quando',
  'não sabe em vez de improvisar; não prometer em nome de outras áreas.',
  '',
  'Estes limites protegem o usuário do próprio agente e NÃO dependem de briefing.',
  'Escreva-os sempre, mesmo que ele não tenha pedido.',
  '',
  'NÃO EXAGERE. Baseline boa é enxuta e sem redundância:',
  '  · 3 a 6 itens por faceta quando não há playbook — com playbook, o número sai',
  '    dos princípios dele, não desta régua;',
  '  · um conceito por item — se dois itens se sobrepõem, funda-os;',
  '  · nada de item genérico que serviria para qualquer agente do mundo',
  '    ("seja educado", "ajude o usuário").',
  '',
  'IMPLICAÇÃO SEMÂNTICA ≠ REQUISITO DE NEGÓCIO INVENTADO.',
  '',
  '  "Representante comercial" PERMITE inferir: venda consultiva, descoberta de',
  '  necessidade, tratamento de objeção, construção de valor, não pressionar.',
  '',
  '  NÃO permite inferir: "oferece o plano Pro por R$ 99", "atende São Paulo",',
  '  "prazo de 5 dias". Isso é conhecimento de Project/Campaign, não Agent Core,',
  '  e inventar aqui faz o agente mentir para o cliente do usuário.',
  '',
  'QUANDO NÃO HÁ PAPEL SUFICIENTE, CONDUZA — NÃO CHUTE.',
  '',
  'Um pedido como "crie um agente", sem papel nem propósito, não carrega',
  'implicação profissional nenhuma. Escolher uma profissão por conta própria',
  'seria inventar a intenção do usuário, que é o erro oposto e igualmente grave.',
  '',
  'Nesse caso: entregue apenas identidade provisória e objetivo genérico, deixe',
  'as facetas vazias, e use `gaps` para perguntar o que o agente faz e com quem',
  'ele fala. Uma pergunta boa vale mais que uma baseline inventada.',
  '',
  'A régua: se o pedido nomeia uma FUNÇÃO reconhecível, derive a baseline inteira.',
  'Se nomeia só um adjetivo ("um agente objetivo"), estruture o que o adjetivo',
  'implica e pergunte o papel. Se não nomeia nada, pergunte.',
].join('\n');

/** Criação: o ofício inteiro. */
const CRAFT_GUIDANCE = [CRAFT_BASIS, CRAFT_CREATION, CRAFT_WRITING].join('\n');

/** Ajuste: a distinção fato/ofício e como escrever — sem a régua de montar do zero. */
const CRAFT_ADJUST = [CRAFT_BASIS, CRAFT_WRITING].join('\n');

/**
 * O catálogo vai na instrução porque o schema sozinho dá o NOME do checker, não
 * quando usá-lo. Sem isto o modelo marcava tudo como SOFT e nenhuma regra do
 * usuário virava verificação de verdade.
 */
const CHECK_GUIDANCE = [
  'Quando a regra for mecanicamente verificável, use `enforcement: "DETERMINISTIC"`',
  'e preencha `check` com um destes — e SOMENTE com um destes:',
  describeRuleChecksForPrompt(),
  '',
  'Não invente nome de checker. Regra sem checker correspondente é "HARD" quando',
  'é obrigação inegociável, e "SOFT" quando é preferência.',
].join('\n');

/**
 * Operações do OS sobre o Agent Core (§17).
 *
 * A experiência não é formulário: o usuário diz "preciso que ele seja mais
 * pragmático e objetivo" e o OS interpreta, estrutura, deduplica e versiona.
 */

const agentOutputBase = {
  ...intentField,
  interpretedIntent: describedField(300),
  rationale: z.string().trim().min(3).max(2000),
  humanSummary: narrativeField(6000),
};

const agentOutputTail = {
  mutations: agentMutationsSchema,
  conflicts: z
    .array(z.object({ itemCode: z.string().max(10).optional(), description: z.string().max(400) }))
    .max(10)
    .default([]),
  gaps: z.array(z.string().max(300)).max(10).default([]),
};

/**
 * A correção era de OFÍCIO, não deste agente.
 *
 * Só existe no AJUSTE. Criando um agente não há correção nenhuma para rotear —
 * o usuário descreveu um papel, não apontou um comportamento errado — e o campo
 * ali era peso morto no contrato mais carregado do sistema.
 */
const craftSuggestionField = {
  /**
   * Vem ANTES de `mutations`, e não é estética.
   *
   * Estava depois do array de 25 itens e simplesmente não era preenchido: o
   * modelo chegava ao fim da parte longa e não escrevia o campo curto. Foi o
   * que aconteceu com "não repita pergunta sobre fato já declarado" — ofício
   * puro, aplicado só naquele agente, sem virar pauta de ninguém.
   *
   * A regra do projeto é a mesma de sempre: curto e decisório antes de longo e
   * mecânico.
   */
  craftSuggestion: z
    .object({
      summary: z.string().trim().min(5).max(300),
      /**
       * O princípio, escrito como ele entraria no playbook.
       *
       * Vale para QUALQUER agente daquele papel — sem o caso, sem a profissão
       * do interlocutor, sem o negócio de quem pediu (ver "ephemeral_facts").
       */
      statement: z.string().trim().min(20).max(700),
      facet: z.enum(PLAYBOOK_FACETS),
      /**
       * A chave do princípio que isto REFINA, ou uma nova.
       *
       * Reutilizar a chave existente corrige o princípio NO LUGAR; inventar uma
       * cria um segundo dizendo quase a mesma coisa — e o playbook passa a ter
       * duas regras que divergem na primeira vez que alguém editar só uma.
       */
      semanticKey: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
        .max(60),
      /** Por que isto é do ofício e não deste agente. Vira o motivo da versão. */
      reason: z.string().trim().min(10).max(300),
      /**
       * Em QUAL piso isto entra.
       *
       * `CONDUCT` é a conduta de qualquer agente que fala com gente — espelhar
       * o registro, admitir o que não sabe, não deduzir o que ninguém disse.
       * `CRAFT` é o ofício DESTE papel: como um bom vendedor consultivo trata
       * uma objeção não é como uma recepcionista trata uma remarcação.
       *
       * O OS só alcançava o playbook do papel, então correção universal ia
       * parar lá — e o piso de todos os outros papéis continuava sem ela.
       */
      scope: z.enum(['CONDUCT', 'CRAFT']).optional(),
      /** Orientação ponderável, ou proibição que não se negocia. */
      enforcement: z.enum(['SOFT', 'HARD']).optional(),
    })
    .optional(),
};

/**
 * Criação: a identidade é campo OBRIGATÓRIO DE TOPO.
 *
 * Mesma lição medida na criação de projeto: enterrada no array de mutações, ela
 * era omitida e o agente nascia sem nome nem papel.
 */
/**
 * A ORDEM das propriedades importa, e não é estética.
 *
 * O modelo escreve o JSON na ordem em que o schema o apresenta. Com `identity`
 * e `objective` no fim, ele produzia primeiro um array de 25 mutações — a parte
 * longa — e só então os dois campos curtos que não podem faltar. Medido: eles
 * chegavam `undefined`, e a operação inteira era recusada depois de dois
 * minutos de geração já paga.
 *
 * Primeiro o que é curto e obrigatório; depois o que é longo. Se a geração
 * degradar no fim, degrada no que dá para completar depois — nunca na
 * identidade do agente.
 */
export const createAgentOutputSchema = z.object({
  identity: z.object({
    name: z.string().trim().min(1).max(80),
    role: z.string().trim().min(1).max(160),
  }),
  objective: z.string().trim().min(1).max(600),
  ...agentOutputBase,
  ...agentOutputTail,
});

export const configureAgentOutputSchema = z.object({
  ...agentOutputBase,
  ...craftSuggestionField,
  ...agentOutputTail,
});

const ALL_AGENT_MUTATIONS: readonly AgentMutationKind[] = [
  'SET_AGENT_IDENTITY',
  'SET_AGENT_OBJECTIVE',
  'SET_AGENT_ENGAGEMENT',
  'UPSERT_PERSONALITY_TRAIT',
  'UPSERT_COMMUNICATION_TRAIT',
  'UPSERT_SKILL',
  'UPSERT_BEHAVIOR',
  'UPSERT_STRATEGY',
  'UPSERT_HARD_RULE',
  'UPSERT_LIMIT',
];

const AGENT_POLICY_SECTIONS = [
  ...BASE_POLICY_SECTIONS,
  'baseline_conduct',
  'deduplication',
  'craft',
  'agent_taxonomy',
  'advisory',
] as const;

export const CREATE_AGENT: MyAIHubOperation = {
  name: 'agent.create',
  scope: 'ROOT',
  label: 'Criando o agente',
  purpose: 'Cria um AGENTE novo a partir do papel que o usuário descrever.',
  targetType: 'AGENT',
  steps: [
    { id: 'think', label: 'Entendendo e estruturando o agente' },
    { id: 'persist', label: 'Salvando e versionando' },
  ],
  canonicalSchemaVersion: 1,
  // Criação NÃO remove: não há nada para remover, e permitir a mutação abriria
  // uma porta sem uso (§7.2).
  allowedMutations: ALL_AGENT_MUTATIONS,
  outputSchema: createAgentOutputSchema,
  policySections: AGENT_POLICY_SECTIONS,
  contextRequirements: [],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 14_000,
  instruction: [
    'O usuário descreveu, em linguagem natural, um AGENTE que ele quer ter. Sua',
    'tarefa é ENTREGAR ESSE AGENTE PRONTO — não coletar requisitos para depois.',
    '',
    '`identity.name` é o nome próprio do agente. Se o usuário já disse um nome',
    '(procure algo como "Nome deste NOVO agente: X"), use ESSE, sem alterar.',
    'Se ele deixou em branco, crie um nome próprio curto que combine com o PAPEL',
    '— nunca com o projeto, a empresa ou a campanha; não repita o papel como se',
    'fosse nome.',
    '`identity.role` é o papel em uma linha: "Representante Comercial Estratégico".',
    '`objective` é o resultado que o agente existe para alcançar, em uma frase.',
    '',
    'O AGENTE NASCE SEM NEGÓCIO, mesmo quando é pedido de dentro de um projeto ou',
    'de uma campanha. O que a conversa disse sobre aquele negócio — nome da',
    'empresa, do projeto, da campanha, da linha, do produto, o público daquela',
    'ação — diz ONDE ele vai atuar, não QUEM ele é. Nada disso entra na',
    'identidade, no objetivo nem em item nenhum: ele chega a cada conversa pelo',
    'projeto e pela campanha, que somam no prompt em execução.',
    '',
    '  errado  objetivo "Qualificar demandas para a Linha Industrial X."',
    '  certo   objetivo "Qualificar demandas de clientes industriais antes de',
    '          qualquer proposta." — e, em `humanSummary`, dizer que o foco na',
    '          Linha Industrial X é da campanha, oferecendo registrar lá.',
    '',
    'O SETOR pode entrar (ele muda vocabulário e objeção); o NOME do negócio não.',
    '',
    'Em `mutations`, escreva a configuração completa. Não repita identidade nem',
    'objetivo ali — eles já vão nos campos de topo.',
    '',
    CRAFT_GUIDANCE,
    '',
    'Se o briefing tiver dois adjetivos e nada mais, ainda assim entregue o agente',
    'completo. O usuário disse o que queria; a implementação é sua.',
    '',
    'PERGUNTE SOBRE O AGENTE, NUNCA SOBRE O NEGÓCIO.',
    '',
    'A regra de nível está na seção "information_level", e aqui ela tem uma',
    'consequência direta: use `gaps` para 2 a 3 perguntas sobre CONDUTA e',
    'FRONTEIRA — as coisas que valem para este agente em qualquer campanha:',
    '',
    '  entra   "Em que momento ele deve passar a conversa para uma pessoa?"',
    '          (fronteira do agente; vale em toda campanha)',
    '  entra   "Existe algo que ele NUNCA pode dizer ou prometer, em nenhuma',
    '          situação?" (vira limite permanente)',
    '  entra   "Como ele deve reagir quando não souber a resposta?"',
    '          (conduta; muda o comportamento em qualquer contexto)',
    '  entra   "Ele trata as pessoas por você ou de forma mais formal?"',
    '          (só o usuário sabe como a marca dele fala)',
    '',
    '  fora    "Qual produto ele vai oferecer?"      (é da CAMPANHA)',
    '  fora    "Qual o desconto máximo?"             (é da CAMPANHA)',
    '  fora    "Quem é o público-alvo?"              (é da CAMPANHA)',
    '  fora    "Ele deve ser educado?"               (você já sabe)',
    '  fora    "Qual o tom de voz?"                  (é ofício seu; derive)',
    '  fora    "Quais skills ele precisa ter?"       (é o que ele delegou)',
    '',
    'A régua: se a resposta mudaria de uma campanha para outra, NÃO pergunte aqui.',
    '',
    'E A PERGUNTA TAMBÉM SAI DO PAPEL.',
    '',
    'Um conjunto fixo de perguntas serviria para qualquer agente — e por isso não',
    'serve para nenhum. Cada função tem decisões de conduta próprias, e são essas',
    'que você não consegue derivar sozinho. Pense: "para projetar bem ESTE tipo',
    'de agente, o que eu, como engenheiro de prompt, preciso saber e não sei?".',
    '',
    '  representante comercial',
    '    · Em que ponto ele deve parar de insistir e aceitar o não?',
    '    · Ele pode falar de valores quando a campanha informar, ou nunca?',
    '    · Ele qualifica antes de encaminhar, ou encaminha todo interessado?',
    '',
    '  atendente de suporte',
    '    · Até onde ele tenta resolver antes de abrir chamado?',
    '    · Ele pode admitir falha do produto, ou isso é sempre com o time?',
    '',
    '  recepcionista',
    '    · Ele agenda direto ou só registra o pedido e confirma depois?',
    '    · Existe alguém que ele nunca deve interromper para transferir?',
    '',
    '  atendente de restaurante',
    '    · Ele fecha o pedido ou só tira dúvida e passa para o salão?',
    '    · Como responde quando perguntam sobre alergênicos ou ingredientes?',
    '',
    'Repare no padrão: todas são sobre AUTONOMIA e FRONTEIRA daquele ofício —',
    'coisas que valem em qualquer campanha e que só quem opera o negócio sabe.',
    'Nenhuma pergunta sobre produto, preço ou público, que são da campanha.',
    '',
    'Escreva na língua do negócio dele, não na sua. Nada de "faceta", "canônico",',
    '"enforcement" ou "prompt" — o usuário não precisa aprender a nossa modelagem',
    'para responder o que ele já sabe sobre o próprio atendimento.',
    '',
    CHECK_GUIDANCE,
    '',
    'QUEM ABRE A CONVERSA MUDA O AGENTE INTEIRO',
    '',
    'A fala do usuário diz quem começa: a PESSOA ou o AGENTE. Isso não é um',
    'detalhe de tela — quem aborda primeiro precisa de abertura, gancho e',
    'condução; quem responde precisa de acolhimento e diagnóstico. São ofícios',
    'diferentes, e a configuração tem que refletir o que foi escolhido.',
    '',
    'Quando o AGENTE começa, configure COMO ele abre — não O QUE ele diz.',
    '',
    '  openerMode: "ADAPTIVE"  é o default e quase sempre o certo. A abertura é',
    '     formulada na hora. Escreva em `openerGuidance`, em terceira pessoa, o que',
    '     a primeira fala precisa fazer: cumprimentar, se apresentar, pedir o nome,',
    '     ancorar no motivo do contato — o que couber ao papel.',
    '',
    '  openerMode: "SCRIPTED"  só quando o usuário pedir a MESMA frase sempre, com',
    '     essas palavras. Aí `opener` carrega o texto literal.',
    '',
    'Um exemplo que ele deu para ilustrar o tom NÃO é pedido de roteiro — ver a',
    'seção "examples". Guarde o exemplo em `opener` e mantenha o modo ADAPTIVE: ele',
    'vira referência de tom, não a fala.',
    '',
    'E SE HOUVER UM PLAYBOOK DE OFÍCIO NO CONTEXTO, confira a cobertura antes de',
    'responder — é o erro mais provável aqui:',
    '',
    '  · cada PRINCÍPIO do playbook virou um item? Conte. Catorze princípios não',
    '    cabem em nove itens, e o que sobra é justamente o que o playbook tinha de',
    '    melhor — o resto o modelo já saberia sozinho.',
    '  · cada NUNCA virou um limite (proibição) ou uma regra dura (obrigação)?',
    '    Um agente comercial sem os limites do ofício é o agente que o usuário',
    '    devolve depois do primeiro teste.',
    '',
    'A cobertura mínima citada lá em cima é para quando NÃO há playbook. Havendo,',
    'ela é piso baixo demais e não serve de referência.',
    '',
    'E, com playbook ou sem, confira a CONDUTA BASELINE — ela vale para todo',
    'agente e é a primeira coisa que se perde quando há muita coisa a escrever:',
    '',
    '  · ele ESPELHA o registro do interlocutor (formal com quem é formal, solto',
    '    com quem escreve solto)? Isso é um item de COMUNICAÇÃO, e nenhum playbook',
    '    o substitui.',
    '  · o tamanho da resposta é proporcional ao canal e à pergunta?',
    '  · ele admite o que não sabe em vez de improvisar?',
  ].join('\n'),
  outputContract: [
    // Qualquer coisa nova entra AQUI, antes do contrato — nunca depois. Ver a
    // nota no fim deste bloco.
    'Havendo playbook de ofício no contexto, confira a cobertura antes de',
    'fechar: cada princípio virou item, cada NUNCA virou limite.',
    '',
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'Este é o fim do contexto, e o que vem por último é o que você mais retém.',
    'Por isso o contrato de saída se repete aqui:',
    '',
    '  identity   OBRIGATÓRIO. Objeto com `name` (nome próprio curto) e `role`',
    '             (a função em uma linha). Sem isto o agente nasce sem nome.',
    '  objective  OBRIGATÓRIO. Uma frase: o resultado que ele existe para',
    '             alcançar.',
    '  mutations  a configuração completa, nas facetas certas — incluindo',
    '             SET_AGENT_ENGAGEMENT quando a fala disser quem começa.',
    '',
    'Nenhum dos dois primeiros pode faltar, mesmo que o pedido seja vago — nesse',
    'caso use um nome provisório e um objetivo genérico, e pergunte em `gaps`.',
    //
    // NADA entra depois desta linha.
    //
    // Já aconteceu duas vezes: uma checagem de cobertura acrescentada DEPOIS do
    // contrato, e a criação de agente passou a omitir `identity` e `objective`.
    // Custo medido de um turno assim: 107s recusados + 137s de correção. Movida
    // a checagem para antes, a mesma criação levou 13s.
  ].join('\n'),
};

export const CONFIGURE_AGENT: MyAIHubOperation = {
  name: 'agent.configure',
  // Ajusta o que existe: sem alvo o runner criaria um novo (ver requiresTarget).
  requiresTarget: true,
  scope: 'AGENT',
  label: 'Ajustando o agente',
  purpose:
    'Responde QUALQUER pergunta, comparação ou diagnóstico sobre um AGENTE, e altera a BASE dele — que vale em todo projeto e toda campanha: personalidade, comunicação, skills, comportamentos, estratégias, limites, regras, abertura e cortesia.',
  targetType: 'AGENT',
  steps: [
    { id: 'think', label: 'Entendendo o pedido e ajustando' },
    { id: 'persist', label: 'Salvando nova versão' },
  ],
  canonicalSchemaVersion: 1,
  allowedMutations: [...ALL_AGENT_MUTATIONS, 'REMOVE_AGENT_ITEM'],
  outputSchema: configureAgentOutputSchema,
  // "calibration_level" só aqui: rotear instância/arquétipo pressupõe uma
  // correção para rotear. Na CRIAÇÃO não existe nenhuma — o usuário descreveu
  // um papel, não apontou um comportamento errado — e a seção era 700 tokens de
  // deliberação disputando atenção com o contrato de saída mais pesado do
  // sistema, que é justamente onde o modelo já erra por dispersão.
  policySections: [...AGENT_POLICY_SECTIONS, 'calibration_level'],
  contextRequirements: [{ key: 'agent.core', priority: 85, cacheable: true, required: true }],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  // 18.000 era o teto de quando a policy tinha metade das seções de hoje.
  // Medido: 9.868 tokens só de policy, e o contexto saturava em 17.829 — o
  // ofício e a conversa de teste ficavam de fora de um ajuste que é sobre
  // exatamente as duas coisas. O teto é nosso, não do provider.
  tokenBudget: 24_000,
  instruction: [
    'O usuário quer ajustar um agente que já existe. A configuração atual está no',
    'contexto, e ela é o PISO: o resultado deste ajuste precisa ser um agente igual',
    'ou melhor, nunca menor.',
    '',
    'AJUSTAR É REFINAR, NÃO RECOMEÇAR. Antes de criar item novo, procure um que já',
    'expresse a MESMA ideia e refine-o reutilizando o mesmo `semanticKey`. "Seja',
    'objetivo", "não explique demais" e "respostas curtas" são a MESMA coisa: um',
    'item `communication.objectivity`, não três.',
    '',
    'Ao refinar, o texto novo precisa ser mais ESPECÍFICO que o anterior, não mais',
    'curto. Trocar uma instrução detalhada por um adjetivo é regressão, mesmo que',
    'pareça mais limpo — e o domínio vai desfazer isso.',
    '',
    'Distinga as facetas: personalidade é como o agente É; comunicação é como ele',
    'SE COMUNICA; skill é o que ele SABE FAZER; comportamento é como ele AGE;',
    'regra é obrigação; limite é proibição.',
    '',
    'Só remova item se o usuário pediu explicitamente para remover aquilo.',
    '',
    'E LEIA A NEGAÇÃO COM CUIDADO — ver a seção "diagnosis".',
    '',
    '  "não peça o nome"            pedido: o comportamento não deve existir',
    '  "NEM está pedindo o nome"    relato: o comportamento deveria existir e',
    '                               falhou. Reforce, nunca remova.',
    '',
    'Um relato de falha lido como pedido de remoção apaga exatamente o que o',
    'usuário queria — e a resposta ainda sai confiante dizendo que ajustou. Na',
    'dúvida entre as duas leituras, RESPONDA o que você encontrou na configuração',
    'e pergunte, em vez de mexer.',
    '',
    'REPETIÇÃO É SINAL DE FRACASSO SEU, NÃO FALTA DE CLAREZA DELE.',
    '',
    'O histórico da conversa está no contexto. Se o usuário já apontou este mesmo',
    'comportamento antes, o ajuste anterior NÃO funcionou — e repetir uma correção',
    'da mesma intensidade vai falhar de novo. Escale:',
    '',
    '  1ª vez  refine o item: reescreva o `statement` de forma mais específica.',
    '  2ª vez  suba o `enforcement` para HARD e escreva a instrução como PROIBIÇÃO',
    '          explícita, com exemplo do que não fazer.',
    '  3ª vez  procure o que está CAUSANDO o comportamento e remova ou reescreva',
    '          esse item. Insistir em proibir sem tirar a causa não resolve: se',
    '          uma skill manda "interpretar reações", ela vai continuar gerando',
    '          narração por mais que um limite proíba narração.',
    '',
    'Contradição entre itens é a causa mais comum de comportamento que não morre.',
    'Quando encontrar uma, diga em `conflicts` qual item briga com qual — e',
    'resolva, em vez de empilhar mais uma regra por cima.',
    '',
    'PERSONA É COMO A RESPOSTA É ESCRITA, não um enfeite na resposta.',
    '',
    'Pedir "seja um cachorro" não significa falar como pessoa e acrescentar um',
    'latido no fim, nem narrar ações entre asteriscos. Significa que a FORMA da',
    'resposta muda: um cachorro não explica, não aconselha e não constrói frase.',
    'Quando o usuário pede uma persona não humana, escreva no `statement` o que a',
    'resposta PODE conter — e o que ela não pode — em vez de descrever o',
    'personagem por fora.',
    '',
    'Se o pedido for vago ("melhora", "faltou coisa", "completa isso"), NÃO devolva',
    'array vazio: é sua deixa para preencher as lacunas do agente com ofício. Olhe',
    'quais facetas estão magras e escreva o que um bom profissional daquele papel',
    'teria ali.',
    '',
    CRAFT_ADJUST,
    '',
    CHECK_GUIDANCE,
  ].join('\n'),
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'O agente atual é o PISO: nenhum item some sem pedido explícito de remoção, e',
    'nenhum `statement` fica mais curto do que já era.',
    '',
    'LIMITE DO SISTEMA: preenchendo `limitation`, procure na configuração item que',
    'PROMETA essa capacidade (ex.: "envia o orçamento por e-mail"). Havendo, o',
    'turno é CHANGE: reescreva o item para o que o agente consegue fazer (pedir o',
    'contato, oferecer o link da CTA, dizer que a equipe retorna) e diga isso.',
    '',
    'INSTÂNCIA OU ARQUÉTIPO? Esta correção vale só para ESTE agente, ou para',
    'qualquer agente deste mesmo papel? Sendo de ofício, aplique no agente do',
    'mesmo jeito E preencha `craftSuggestion` — o usuário não espera por ninguém,',
    'e a plataforma fica sabendo. Na dúvida, é instância: não preencha.',
    '',
  ].join('\n'),
};
