import { z } from 'zod';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import { AI_MODEL_CATALOG, MODEL_ROLES } from '@myaihub/shared';
import { getOperation, listOperations, type MyAIHubOperation } from '../domain/operation.js';
import { SYSTEM_ACTIONS, type EntityKind, type SystemActionSpec } from '../domain/system-action.js';
import { REQUEST_SIGNALS, type RequestSignal } from '../domain/request-signals.js';
import {
  isKnownEntity,
  type AccountInventory,
  type AccountInventoryReader,
  type InventoryEntry,
} from './account-inventory.js';
import type { SystemActionArgs } from './system-action-executor.js';

/**
 * O S.O ESCOLHE O QUE FAZER E SOBRE O QUÊ — em qualquer lugar do produto.
 *
 * Duas limitações caíram aqui, e elas eram a mesma limitação vista de ângulos
 * diferentes: o S.O agia pela TELA, não pelo pedido.
 *
 * A primeira era a OPERAÇÃO. Ela chegava pronta do painel — o último botão
 * clicado, ou o padrão da rota — e toda frase do usuário era forçada dentro
 * dela. Medido: ele pediu "cria a campanha de estamparia" com o chip em
 * `refinar perfil`; a operação rodou, não tinha como criar campanha nenhuma, e
 * o modelo descreveu o que FARIA. A tela continuou vazia e a resposta parecia
 * um "pronto". Nada falhou, e nada aconteceu.
 *
 * A segunda era o ESCOPO. Estando no agente, o S.O só sabia de agentes; para
 * ele entender que se falava de um projeto, era preciso NAVEGAR até o projeto.
 * Isso faz dele um assistente de página. Um sistema operacional não pede que
 * você abra a pasta certa antes de mandar copiar um arquivo: ele resolve de que
 * arquivo você falou.
 *
 * Agora as operações candidatas são TODAS, e o alvo sai do INVENTÁRIO da conta —
 * o nome que o usuário escreveu vira o id. A rota vira PISTA (é provável que
 * quem está no agente X esteja falando do agente X), nunca cerca.
 *
 * ========== POR QUE UM MODELO, E NÃO UMA REGRA ==========
 *
 * Separar "me dá uma dica" de "cria a campanha", e "o Sankar" de "o Alex", é
 * semântico. Este repositório já pagou para aprender que heurística sobre
 * palavra erra — foi por isso que `intent` (ANSWER x CHANGE) virou decisão do
 * modelo. Rotear é a mesma classe, um degrau acima.
 *
 * ========== POR QUE UMA CHAMADA PRÓPRIA, E BARATA ==========
 *
 * A alternativa era a operação declarar na saída "isto não é comigo" e o runner
 * refazer. Custaria zero no caminho feliz — mas o turno desperdiçado seria o
 * CARO: 8 a 16 mil tokens de `hub.reasoning` já gastos para descobrir que a
 * pergunta era para outro. Aqui a decisão sai em `hub.fast`, com o prompt
 * mínimo que ela exige: a frase do usuário, uma linha por operação e o
 * inventário.
 *
 * E ela só acontece quando existe decisão a tomar: mensagem vazia responde sem
 * chamar ninguém — a requisição que não muda nada é a que não deve existir.
 */

const routeSchema = z.object({
  /*
    A ordem é engenharia de prompt: o modelo escreve o JSON na ordem em que o
    schema o apresenta, e o que decide vem primeiro. `question` por último de
    propósito — ela só existe quando as outras não puderam ser resolvidas.
  */
  /** Nome exato da operação escolhida, copiado da lista. */
  operation: z.string().trim().max(60).default(''),
  /** Id da entidade alvo, copiado do inventário. Vazio quando a operação cria. */
  targetId: z.string().trim().max(60).default(''),
  /** Segundo id, só nas AÇÕES que ligam duas coisas (o agente de um vínculo). */
  secondaryId: z.string().trim().max(60).default(''),
  /** Valor curto de uma AÇÃO: uma URL, um "provider:modelo", o começo de um texto. */
  value: z.string().trim().max(2000).default(''),
  /**
   * O usuário CONFIRMOU uma ação irreversível no turno anterior.
   *
   * Só vale quando o S.O perguntou "confirma?" e a resposta foi sim. Uma ordem
   * direta de excluir ainda passa por uma pergunta: o roteador pode ter
   * resolvido o nome para a entidade errada, e aqui errar apaga.
   */
  confirmed: z.boolean().default(false),
  /**
   * O que o pedido É, para a operação carregar só a orientação que ele usa.
   *
   * A policy inteira ia em toda operação: 7.400 tokens num ajuste de saudação.
   * "Relato de falha não é pedido de remoção" só decide alguma coisa quando
   * há relato de falha; "exemplo não é especificação", quando há exemplo. Quem
   * lê a frase já é o roteador — classificar custa uns tokens de saída, e
   * poupa as seções que não se aplicam.
   */
  signals: z.array(z.enum(REQUEST_SIGNALS)).default([]).catch([]),
  /** Em uma linha, o que ele entendeu. Vira aviso quando a operação troca. */
  reason: z.string().trim().max(200).default(''),
  /**
   * A pergunta a fazer quando não dá para saber DE QUE COISA o usuário falou.
   *
   * Adivinhar entre dois projetos com nome parecido significa metade das vezes
   * reconfigurar o errado — e o usuário só descobre depois. Perguntar custa uma
   * frase; errar custa uma versão indevida num documento que ele não estava
   * olhando.
   */
  question: z.string().trim().max(300).default(''),
});

export interface RoutedRequest {
  /** Ausente quando o S.O precisa perguntar antes de agir. */
  operation?: MyAIHubOperation;
  /** Uma AÇÃO do sistema no lugar de uma operação — com os ids já conferidos. */
  action?: { spec: SystemActionSpec; args: Omit<SystemActionArgs, 'message'> };
  /** O alvo que o S.O resolveu, quando resolveu. */
  targetId?: string;
  /**
   * Os sinais do pedido. `undefined` quando o roteador não leu a frase — aí a
   * operação carrega TODA a orientação, que é o padrão seguro.
   */
  signals?: RequestSignal[];
  /** `true` quando o S.O escolheu diferente do que a tela sugeriu. */
  overridden: boolean;
  /** Por que ele trocou, ou o que entendeu. */
  reason: string;
  /** A pergunta, quando ele não soube de que coisa se falava. */
  question?: string;
  costMicros: number;
  totalTokens: number;
}

/**
 * As operações que o S.O pode executar — TODAS, sem filtro de escopo.
 *
 * O filtro por escopo era o que prendia o S.O à tela. O que substituiu a
 * proteção que ele dava é mais forte e mais específico: o alvo é conferido
 * contra o inventário da conta, por TIPO (ver `isKnownEntity`).
 */
export function allOperations(): MyAIHubOperation[] {
  return (['ROOT', 'PROJECT', 'AGENT', 'CAMPAIGN', 'PLAYBOOK'] as const).flatMap((scope) =>
    listOperations(scope),
  );
}

/** De que tipo é o id que esta operação espera receber. */
export function targetKindOf(
  operation: MyAIHubOperation,
): 'PROJECT' | 'AGENT' | 'CAMPAIGN' | 'PLAYBOOK' | null {
  // `PARENT` significa que o id é do DONO do que vai nascer: criar campanha
  // acontece com o id do PROJETO. Confundir os dois faria o runner tentar
  // carregar uma campanha usando o id de um projeto.
  if (operation.scopeIdRole === 'PARENT') return 'PROJECT';

  /*
    CRIAÇÃO NÃO RECEBE ALVO — nem quando o escopo dela tem um tipo.

    `playbook.create` é escopo PLAYBOOK e CRIA. Sem esta linha, o roteador
    resolveria a chave de um ofício EXISTENTE, o runner o carregaria, e
    "escreve um ofício para X" passaria a reescrever o ofício de outro papel —
    um documento que é o piso de todo agente daquele papel, em toda conta.

    `requiresTarget` é a única declaração confiável aqui: o escopo não separa
    criar de ajustar, e derivar disso é o que produziria o erro acima.
  */
  if (!operation.requiresTarget) return null;

  switch (operation.scope) {
    case 'PROJECT':
      return 'PROJECT';
    case 'AGENT':
      return 'AGENT';
    case 'CAMPAIGN':
      return 'CAMPAIGN';
    case 'PLAYBOOK':
      return 'PLAYBOOK';
    default:
      // ROOT cria a partir do nada: não há alvo a resolver.
      return null;
  }
}

/** Uma linha por ação: nome, o que faz e o que cada campo recebe. */
function describeAction(action: SystemActionSpec): string {
  const campos = [
    action.target === 'MODEL_ROLE'
      ? `alvo=papel (${MODEL_ROLES.join('|')})`
      : `alvo=${ENTITY_LABEL[action.target]}`,
    action.secondary ? `segundo=${ENTITY_LABEL[action.secondary.kind]}` : null,
    action.value ? `valor=${action.value.meaning}` : null,
    action.destructive ? 'IRREVERSÍVEL' : null,
  ].filter(Boolean);

  const linha = `- ${action.name}: ${action.purpose} [${campos.join('; ')}]`;

  // O catálogo só vai para quem pode usá-lo: é o que permite escrever um
  // "provider:modelo" que exista.
  if (action.name !== 'model.set_route') return linha;
  return `${linha}\n  modelos: ${AI_MODEL_CATALOG.flatMap((entry) =>
    entry.models.map((model) => `${entry.provider}:${model.id}`),
  ).join(', ')}`;
}

const ENTITY_LABEL: Record<EntityKind, string> = {
  PROJECT: 'projeto',
  AGENT: 'agente',
  CAMPAIGN: 'campanha',
  PLAYBOOK: 'ofício',
  KNOWLEDGE: 'fonte de conhecimento',
};

/**
 * APELIDOS no lugar dos ids.
 *
 * Um ULID tem 26 caracteres e o modelo precisa copiá-lo sem errar uma letra —
 * em cada linha do inventário e de novo na resposta. "A1" custa um token e não
 * tem como ser copiado errado. O apelido existe só dentro desta chamada; quem o
 * traduz de volta para id é o código, e o que não traduz é descartado como
 * qualquer id inventado.
 */
export interface AliasedInventory {
  text: string;
  resolve: (alias: string | undefined) => string;
  aliasOf: (id: string) => string | undefined;
}

const ALIAS_PREFIX: Record<EntityKind, string> = {
  PROJECT: 'P',
  AGENT: 'A',
  CAMPAIGN: 'C',
  PLAYBOOK: 'O',
  KNOWLEDGE: 'K',
};

export function aliasInventory(inventory: AccountInventory): AliasedInventory {
  const paraId = new Map<string, string>();
  const paraApelido = new Map<string, string>();

  const grupos: Array<[EntityKind, InventoryEntry[]]> = [
    ['PROJECT', inventory.projects],
    ['AGENT', inventory.agents],
    ['CAMPAIGN', inventory.campaigns],
    ['KNOWLEDGE', inventory.knowledge],
    ['PLAYBOOK', inventory.playbooks],
  ];

  for (const [kind, entries] of grupos) {
    entries.forEach((entry, index) => {
      const apelido = `${ALIAS_PREFIX[kind]}${index + 1}`;
      paraId.set(apelido, entry.id);
      paraApelido.set(entry.id, apelido);
    });
  }

  const linhas: string[] = [];
  for (const [kind, entries] of grupos) {
    if (entries.length === 0) continue;
    linhas.push(`${ENTITY_LABEL[kind].toUpperCase()}S:`);
    for (const entry of entries) {
      const dono = entry.parentId ? paraApelido.get(entry.parentId) : undefined;
      linhas.push(
        `  ${paraApelido.get(entry.id)} ${entry.name} — ${entry.detail}${dono ? ` (projeto ${dono})` : ''}`,
      );
    }
  }

  return {
    text: linhas.length ? linhas.join('\n') : 'A conta ainda não tem nada criado.',
    resolve: (alias) => (alias ? (paraId.get(alias.trim().toUpperCase()) ?? alias.trim()) : ''),
    aliasOf: (id) => paraApelido.get(id),
  };
}

/**
 * A instrução do roteador — curta de propósito.
 *
 * Ela dizia tudo duas vezes e custava 3.172 tokens para escolher um nome e um
 * id, em TODA mensagem do painel: um vínculo de agente, que não chama modelo
 * nenhum depois, gastava 3.608. A regra de nível, que tinha 700 tokens de
 * argumentação, cabe na régua e em três casos — a argumentação continua onde
 * ela decide o CONTEÚDO, na policy da operação que roda depois.
 */
function buildInstruction(input: {
  operations: MyAIHubOperation[];
  actions: readonly SystemActionSpec[];
  inventory: string;
  hint: string;
  /** A ação que a tela oferece — pista, como a própria tela. */
  suggested?: string;
}): string {
  return [
    'Você roteia pedidos do sistema operacional do MyAIHub: escolhe O QUE fazer e SOBRE O QUÊ. Não está preso à tela; resolva pelo que o usuário escreveu, e FAÇA — nunca responda explicando onde clicar.',
    '',
    'OPERAÇÕES (o modelo escreve ou responde):',
    ...input.operations.map(
      (operation) => `- ${operation.name}: ${operation.purpose ?? operation.label}`,
    ),
    '',
    'AÇÕES (comando direto, sem modelo):',
    ...input.actions.map(describeAction),
    '',
    'CONTA (use os apelidos):',
    input.inventory,
    '',
    `TELA: ${input.hint}${input.suggested ? ` A tela oferece: ${input.suggested}.` : ''} — pista, não cerca: "ele", "aqui", "essa" falam dela; nome explícito vence a tela.`,
    '',
    'ESCOLHA',
    '- CRIAR algo a partir de site, link ou texto → a operação que cria (ela mesma lê o link). Ações de conhecimento só valem para projeto que JÁ EXISTE na CONTA.',
    '- Pedido de algo que o MyAIHub NÃO FAZ (enviar e-mail, mensagem ou arquivo, integrar sistema externo, agendar) → a operação que lê a entidade de que ele fala (na dúvida, a da tela). NUNCA a operação mais parecida: CTA é o link oferecido no chat, não um envio.',
    '- Pergunta sobre UMA entidade → a operação que lê aquela entidade: agente → agent.configure; campanha → campaign.refine_strategy; projeto → project.organize_workspace.',
    '- Mudança → a operação/ação com esse poder. Pergunta, dica, análise → a operação que LÊ o contexto (ela decide depois se muda algo). Na dúvida, a que lê mais e muda menos.',
    '- Nível do ajuste: "valeria para o mesmo agente em outra campanha, outro produto, outro público?" Não → campanha (campaign.refine_strategy). Só neste negócio → projeto. Sempre → base do agente (agent.configure).',
    '- Testando uma campanha e reclamando de condução, abertura por produto, pergunta fora de hora → CAMPANHA. Cortesia (cumprimentar, perguntar nome, como a pessoa está), jeito de escrever, limite de ofício, quem inicia → BASE do agente.',
    '',
    'ALVO',
    '- `targetId`/`secondaryId`: apelidos da CONTA, do tipo certo. Criar do zero: alvo vazio. Criar campanha: alvo = projeto.',
    '- Um só candidato do tipo = é ele ("o agente", "o único"). Nunca peça id; pergunte por NOME, listando as opções, e só quando houver mais de uma.',
    '- Resposta curta ("o único", "sim", "pode") responde à SUA última pergunta: execute o pedido original.',
    '- IRREVERSÍVEL: `confirmed: true` só se sua mensagem anterior pediu confirmação disso e ele aceitou. Nunca peça confirmação do resto.',
    '',
    'SINAIS (`signals`, para carregar só a orientação necessária): FAILURE_REPORT se ele relata algo que o agente fez de errado ou deixou de fazer; EXAMPLE se ele cita um exemplo de fala ou texto; INTERLOCUTOR se ele cita o que a pessoa da conversa disse sobre si.',
    '',
    'Preencha `question` só quando não der para decidir, deixando o resto vazio. `reason`: uma linha com o que ele quer.',
  ].join('\n');
}

/**
 * O ROTEADOR NÃO CARREGA POLICY. Nenhuma seção.
 *
 * A primeira versão mandava `core`, `information_level` e `diagnosis` — e a
 * justificativa parecia boa, porque essas seções falam de níveis e de relato de
 * falha. Medido no banco, o custo real: **3.600 tokens de entrada** numa
 * chamada que decide um nome de operação e um id. O bloco de instrução com
 * todas as operações e o inventário inteiro dá ~1.100.
 *
 * Ou seja, dois terços do pedido eram orientação sobre COMO ESCREVER conteúdo,
 * numa chamada que não escreve conteúdo nenhum. Isso pesa três vezes: gasta
 * token em toda mensagem do painel, adia o começo do trabalho de verdade, e
 * aumenta a chance de o pedido travar antes de produzir a primeira palavra —
 * que foi o que virou "o modelo está sobrecarregado" na tela do usuário.
 *
 * O que o roteador precisa saber está no `purpose` de cada operação e no
 * inventário. A policy continua inteira onde ela decide alguma coisa: na
 * operação que roda depois.
 */
const ROUTING_POLICY_SECTIONS: string[] = [];

export class RouteHubRequestUseCase {
  constructor(
    private readonly deps: {
      gateway: LlmGateway;
      inventory: AccountInventoryReader;
    },
  ) {}

  async execute(
    context: TenantContext,
    input: {
      /** Escopo da conversa — vira PISTA, não filtro. */
      scope: string;
      /** Id da tela atual, quando há um. */
      scopeId?: string;
      message: string;
      /** O que o painel sugeriu, quando sugeriu. */
      suggested?: string;
      /**
       * As últimas falas da conversa.
       *
       * "Vincula ELE no Sankar" só tem alvo se o roteador souber de quem se
       * falava; "sim, pode excluir" só é confirmação se ele souber o que foi
       * perguntado.
       */
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
  ): Promise<RoutedRequest> {
    const operations = allOperations();
    // Ação que afeta a plataforma nem aparece para quem não a administra: o use
    // case recusaria de qualquer forma, e oferecê-la seria prometer o que não há.
    const actions = SYSTEM_ACTIONS.filter(
      (action) => !action.adminOnly || context.role === 'ADMIN',
    );
    const sugerida = input.suggested ? getOperation(input.suggested) : undefined;

    // Mensagem vazia: o usuário clicou uma ação e mandou sem escrever. A escolha
    // dele é a única informação que existe, e ela já está na sugestão — chamar
    // o modelo aqui gastaria dinheiro para confirmar o óbvio.
    if (input.message.trim().length === 0 && sugerida) {
      return {
        operation: sugerida,
        ...(input.scopeId ? { targetId: input.scopeId } : {}),
        overridden: false,
        reason: '',
        costMicros: 0,
        totalTokens: 0,
      };
    }

    const inventory = await this.deps.inventory.read(context);
    const aliased = aliasInventory(inventory);

    const routed = await this.deps.gateway.generateStructured(
      context,
      {
        // Decisão curta, e ela fica NA FRENTE do usuário: o turno inteiro
        // espera por ela. `hub.fast` existe exatamente para isto — 10s de
        // travamento, 45s de teto, e o modelo mais barato do catálogo.
        role: 'hub.fast',
        blocks: [
          {
            id: 'routing.instruction',
            kind: 'STABLE' as const,
            trust: 'TRUSTED' as const,
            priority: 90,
            /*
              ESSENCIAL — é o ÚNICO bloco, e sem ele não existe roteamento.

              Não era, e o teto era 3.000. Ao acrescentar ações ao catálogo a
              estimativa passou do teto, o compilador cortou o bloco inteiro e
              o modelo passou a decidir só com a frase do usuário: 10 tokens de
              entrada, medido em `ai_calls`. Sem erro nenhum — ele respondia
              "qual o identificador do agente?" numa conta com um agente só,
              porque não sabia que havia agentes, ações, nem tela.
            */
            essential: true,
            cacheable: false,
            content: buildInstruction({
              operations,
              actions,
              inventory: aliased.text,
              hint: describeHint(input.scope, input.scopeId, inventory, aliased),
              ...(sugerida ? { suggested: sugerida.name } : {}),
            }),
          },
        ],
        messages: [
          // Cortadas: o roteador precisa saber DE QUE se falava, não reler a
          // resposta inteira — um turno do OS pode ter duas telas de texto.
          ...(input.history ?? []).map((turn) => ({
            role: turn.role,
            content: turn.content.length > 300 ? `${turn.content.slice(0, 300)}…` : turn.content,
          })),
          { role: 'user' as const, content: input.message },
        ],
        params: { temperature: 0.1 },
        // O teto é folga, não corte: o bloco é essencial e vai inteiro mesmo
        // acima dele — o inventário já tem teto próprio por tipo.
        tokenBudget: 6_000,
        policySections: ROUTING_POLICY_SECTIONS,
      },
      routeSchema,
    );

    // Apelido volta a ser id AQUI, antes de qualquer conferência: daqui para
    // baixo o código só conhece ids, e o que não traduziu cai na checagem de
    // inventário como qualquer id inventado.
    routed.content.targetId = aliased.resolve(routed.content.targetId);
    routed.content.secondaryId = aliased.resolve(routed.content.secondaryId);

    const acao = actions.find((item) => item.name === routed.content.operation);

    /*
      AÇÃO SOBRE UM TIPO QUE A CONTA NÃO TEM.

      "Crie um projeto a partir deste link" numa conta vazia virou "cadastrar a
      página no conhecimento de um projeto" — há um link na frase —, e o S.O
      perguntou "qual projeto?" a quem não tinha nenhum. A pergunta não tem
      resposta possível: não existe entidade para escolher. Quando o tipo do
      alvo está VAZIO na conta, o pedido só pode ser de criá-lo; havendo
      operação que cria aquele tipo, é ela.
    */
    const criacao = acao && acao.target !== 'MODEL_ROLE' ? CREATION_FOR[acao.target] : undefined;
    if (acao && criacao && entriesOf(inventory, acao.target as EntityKind).length === 0) {
      const operacao = getOperation(criacao);
      if (operacao) {
        return {
          operation: operacao,
          overridden: false,
          reason: routed.content.reason,
          signals: routed.content.signals,
          costMicros: routed.costMicros,
          totalTokens: routed.totalTokens,
        };
      }
    }

    if (acao) {
      return this.resolveAction(acao, routed.content, input.scopeId, inventory, {
        costMicros: routed.costMicros,
        totalTokens: routed.totalTokens,
      });
    }

    const escolhida = operations.find((item) => item.name === routed.content.operation);

    // Ele não soube de que coisa se falava. Perguntar é a resposta certa, e
    // custa uma frase — não uma operação inteira sobre o alvo errado.
    if (!escolhida && routed.content.question) {
      return {
        overridden: false,
        reason: routed.content.reason,
        question: routed.content.question,
        costMicros: routed.costMicros,
        totalTokens: routed.totalTokens,
      };
    }

    // Nome inventado não vira operação. Cair na sugestão da tela é o
    // comportamento de antes — pior que acertar, melhor que rodar uma operação
    // que ninguém pediu com o id de outra coisa.
    const operation = escolhida ?? sugerida;

    if (!operation) {
      return {
        overridden: false,
        reason: routed.content.reason,
        question:
          routed.content.question ||
          'Não consegui identificar o que você quer que eu faça. Pode dizer com outras palavras?',
        costMicros: routed.costMicros,
        totalTokens: routed.totalTokens,
      };
    }

    const alvo = this.resolveTarget(operation, routed.content.targetId, input.scopeId, inventory);

    /*
      AJUSTE SEM ALVO VIRA PERGUNTA, e não uma operação condenada.

      O runner tem a trava que impede isso de virar uma CRIAÇÃO indevida, mas
      chegar lá significa pagar uma operação inteira de `hub.reasoning` para
      falhar. Aqui a pergunta sai pelo que o roteamento já custou — e ela é a
      resposta certa de qualquer forma: se ele não sabe qual projeto ajustar,
      quem sabe é o usuário.
    */
    if (operation.requiresTarget && !alvo.targetId) {
      /*
        NÃO EXISTE NENHUM DAQUELE TIPO: perguntar "qual?" não tem resposta.

        "Mande o orçamento por e-mail no fim" foi para a CTA da campanha numa
        conta sem campanha, e o S.O perguntou "qual item?". Quem não tem nenhum
        não tem o que escolher. A operação que LÊ a entidade da tela responde
        melhor — explica o que existe, pergunta o que falta ou registra o limite.
      */
      const kind = targetKindOf(operation);
      const leitura = readerForScreen(input.scope, input.scopeId, inventory);
      if (kind && entriesOf(inventory, kind).length === 0 && leitura) {
        return {
          operation: leitura.operation,
          targetId: leitura.targetId,
          overridden: false,
          reason: routed.content.reason,
          signals: routed.content.signals,
          costMicros: routed.costMicros,
          totalTokens: routed.totalTokens,
        };
      }

      return {
        overridden: false,
        reason: routed.content.reason,
        question:
          routed.content.question ||
          `Não identifiquei sobre qual item você quer "${operation.label.toLowerCase()}". Qual deles?`,
        costMicros: routed.costMicros,
        totalTokens: routed.totalTokens,
      };
    }

    return {
      operation,
      ...alvo,
      overridden: Boolean(sugerida) && operation.name !== sugerida?.name,
      signals: routed.content.signals,
      reason: escolhida ? routed.content.reason : '',
      costMicros: routed.costMicros,
      totalTokens: routed.totalTokens,
    };
  }

  /**
   * Os ids de uma AÇÃO, conferidos contra o inventário — ou a pergunta que falta.
   *
   * Mesma defesa das operações: id inventado não está no inventário, id do
   * tipo errado está na lista errada. Com um degrau a mais, porque o usuário
   * fala do jeito dele: "vincula no projeto Sankar" nomeia um PROJETO, e o
   * vínculo mora na CAMPANHA. Havendo uma campanha só nele, é ela; havendo
   * várias, perguntar qual é a resposta certa.
   */
  private resolveAction(
    spec: SystemActionSpec,
    content: z.infer<typeof routeSchema>,
    fromScreen: string | undefined,
    inventory: AccountInventory,
    cost: { costMicros: number; totalTokens: number },
  ): RoutedRequest {
    const perguntar = (question: string): RoutedRequest => ({
      overridden: false,
      reason: content.reason,
      question,
      ...cost,
    });

    let target: InventoryEntry | undefined;
    if (spec.target === 'MODEL_ROLE') {
      if ((MODEL_ROLES as readonly string[]).includes(content.targetId)) {
        target = { id: content.targetId, name: content.targetId, detail: '' };
      }
    } else {
      const kind = spec.target;
      target =
        findEntry(inventory, kind, content.targetId) ??
        findEntry(inventory, kind, fromScreen) ??
        onlyOne(inventory, kind);

      if (!target && kind === 'CAMPAIGN') {
        const projeto =
          findEntry(inventory, 'PROJECT', content.targetId) ??
          findEntry(inventory, 'PROJECT', fromScreen);
        const doProjeto = projeto
          ? inventory.campaigns.filter((campaign) => campaign.parentId === projeto.id)
          : [];

        if (projeto && doProjeto.length === 1) target = doProjeto[0];
        if (projeto && doProjeto.length > 1) {
          return perguntar(
            `O projeto ${projeto.name} tem ${doProjeto.length} campanhas: ${doProjeto
              .map((campaign) => campaign.name)
              .join(', ')}. Em qual delas?`,
          );
        }
        if (projeto && doProjeto.length === 0) {
          return perguntar(
            `O projeto ${projeto.name} ainda não tem campanha — e é pela campanha que um agente atua nele. Quer que eu crie uma?`,
          );
        }
      }
    }

    if (!target) {
      return perguntar(
        content.question ||
          `Não identifiquei ${spec.target === 'MODEL_ROLE' ? 'qual papel de modelo' : `qual ${ENTITY_LABEL[spec.target]}`} você quer. Qual?`,
      );
    }

    let secondary: InventoryEntry | undefined;
    if (spec.secondary) {
      secondary =
        findEntry(inventory, spec.secondary.kind, content.secondaryId) ??
        findEntry(inventory, spec.secondary.kind, fromScreen) ??
        onlyOne(inventory, spec.secondary.kind);
      if (!secondary) {
        return perguntar(
          content.question || `Qual ${ENTITY_LABEL[spec.secondary.kind]} você quer usar?`,
        );
      }
    }

    if (spec.value && !content.value) {
      return perguntar(content.question || `Faltou: ${spec.value.meaning}.`);
    }

    if (spec.destructive && !content.confirmed) {
      return perguntar(
        `Confirma que devo ${spec.name === 'agent.delete' ? 'excluir o agente' : 'remover'} **${target.name}**? Isso não tem volta — responda "sim" para eu seguir.`,
      );
    }

    return {
      action: {
        spec,
        args: {
          targetId: target.id,
          targetName: target.name,
          ...(target.parentId ? { targetParentId: target.parentId } : {}),
          ...(secondary ? { secondaryId: secondary.id, secondaryName: secondary.name } : {}),
          ...(content.value ? { value: content.value } : {}),
        },
      },
      overridden: false,
      reason: content.reason,
      ...cost,
    };
  }

  /**
   * O alvo, conferido contra o inventário POR TIPO.
   *
   * Esta é a defesa que substituiu a checagem de escopo da rota — e é mais
   * forte, porque agora quem escolhe o id é o S.O e o risco mudou de forma: o
   * modelo pode devolver um id que existe mas é de outra coisa. Id do tipo
   * errado é descartado, e o da tela atual assume no lugar quando serve.
   */
  private resolveTarget(
    operation: MyAIHubOperation,
    chosen: string,
    fromScreen: string | undefined,
    inventory: AccountInventory,
  ): { targetId?: string } {
    const kind = targetKindOf(operation);
    if (!kind) return {};

    if (chosen && isKnownEntity(inventory, kind, chosen)) return { targetId: chosen };
    if (fromScreen && isKnownEntity(inventory, kind, fromScreen)) return { targetId: fromScreen };

    const unico = kind === 'PLAYBOOK' ? undefined : onlyOne(inventory, kind);
    if (unico) return { targetId: unico.id };

    // Sem alvo válido a operação falha logo adiante, com a mensagem do runner.
    // Inventar um id aqui trocaria um erro claro por uma escrita no lugar errado.
    return {};
  }
}

/** A operação que CRIA cada tipo — para quando o tipo ainda não existe na conta. */
const CREATION_FOR: Partial<Record<EntityKind, string>> = {
  PROJECT: 'project.create_from_brief',
  AGENT: 'agent.create',
};

/** A operação que LÊ a entidade que está na tela — a que responde sobre ela. */
const READER_FOR: Partial<Record<string, { kind: EntityKind; operation: string }>> = {
  AGENT: { kind: 'AGENT', operation: 'agent.configure' },
  CAMPAIGN: { kind: 'CAMPAIGN', operation: 'campaign.refine_strategy' },
  PROJECT: { kind: 'PROJECT', operation: 'project.organize_workspace' },
};

function readerForScreen(
  scope: string,
  scopeId: string | undefined,
  inventory: AccountInventory,
): { operation: MyAIHubOperation; targetId: string } | null {
  const leitor = READER_FOR[scope];
  if (!leitor || !scopeId || !isKnownEntity(inventory, leitor.kind, scopeId)) return null;
  const operation = getOperation(leitor.operation);
  return operation ? { operation, targetId: scopeId } : null;
}

function entriesOf(inventory: AccountInventory, kind: EntityKind): InventoryEntry[] {
  return {
    PROJECT: inventory.projects,
    AGENT: inventory.agents,
    CAMPAIGN: inventory.campaigns,
    PLAYBOOK: inventory.playbooks,
    KNOWLEDGE: inventory.knowledge,
  }[kind];
}

/**
 * O candidato, quando só existe UM.
 *
 * "Vincule o agente criado aqui" numa conta com um agente só não é ambíguo — e
 * o S.O perguntou "qual o identificador do agente?". Depois, à resposta "o
 * único que tem", pediu confirmação. Duas perguntas para uma decisão que não
 * existia. Isto é código e não instrução porque a contagem é um FATO do
 * inventário: não há o que o modelo interpretar.
 *
 * Ofício fica de fora: o catálogo é da plataforma, e "o ofício" quase nunca
 * significa "o único que existe".
 */
function onlyOne(inventory: AccountInventory, kind: EntityKind): InventoryEntry | undefined {
  const lista = {
    PROJECT: inventory.projects,
    AGENT: inventory.agents,
    CAMPAIGN: inventory.campaigns,
    PLAYBOOK: [],
    KNOWLEDGE: inventory.knowledge,
  }[kind];
  return lista.length === 1 ? lista[0] : undefined;
}

function findEntry(
  inventory: AccountInventory,
  kind: EntityKind,
  id: string | undefined,
): InventoryEntry | undefined {
  if (!id || !isKnownEntity(inventory, kind, id)) return undefined;
  const lista = {
    PROJECT: inventory.projects,
    AGENT: inventory.agents,
    CAMPAIGN: inventory.campaigns,
    PLAYBOOK: inventory.playbooks,
    KNOWLEDGE: inventory.knowledge,
  }[kind];
  return lista.find((entry) => entry.id === id);
}

/** Onde o usuário está, em uma frase que o modelo consiga usar. */
function describeHint(
  scope: string,
  scopeId: string | undefined,
  inventory: AccountInventory,
  aliased: AliasedInventory,
): string {
  if (!scopeId) return 'Ele está na tela inicial, sem nenhuma entidade aberta.';

  const achar = (entries: { id: string; name: string }[]): string | undefined =>
    entries.find((entry) => entry.id === scopeId)?.name;

  const nome =
    achar(inventory.projects) ??
    achar(inventory.agents) ??
    achar(inventory.campaigns) ??
    achar(inventory.playbooks);

  const rotulo = { PROJECT: 'projeto', AGENT: 'agente', CAMPAIGN: 'campanha', PLAYBOOK: 'ofício' }[
    scope
  ];

  if (!nome || !rotulo) return 'Ele está na tela inicial, sem nenhuma entidade aberta.';
  return `Ele está olhando o ${rotulo} "${nome}" (${aliased.aliasOf(scopeId) ?? scopeId}).`;
}
