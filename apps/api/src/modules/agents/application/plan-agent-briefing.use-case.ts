import { z } from 'zod';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import {
  CORE_PLAYBOOK_KEY,
  describeCatalogForPrompt,
  toCatalogEntry,
  type AgentPlaybook,
} from '../../myaihub/domain/playbook.js';
import type { PlaybookRepository, PolicyRepository } from '../../myaihub/domain/repositories.js';
import { MASTER_POLICY_NAME } from '../../myaihub/domain/policy.js';

/**
 * As perguntas que o OS faz ANTES de criar o agente (§72, Flow 2).
 *
 * A ordem importa e não é detalhe de tela: perguntar depois de criar significa
 * criar sem saber, e depois pedir ao modelo que refaça metade da configuração —
 * dois turnos pagos para chegar onde um chegaria. Pior: o usuário lê um agente
 * pronto e assume que aquilo é a resposta final.
 *
 * Duas réguas, e as duas precisam passar.
 *
 * A primeira é FATO x OFÍCIO: "você vende para empresa ou pessoa física?" só o
 * usuário sabe; "como um comercial conduz uma objeção?" é engenharia de prompt,
 * e perguntar devolve a ele o trabalho que veio delegar.
 *
 * A segunda é o NÍVEL, e foi a que faltava aqui. O agente pertence à CONTA e
 * atua em qualquer projeto — então produto, preço, cliente ideal e desconto
 * máximo são fatos legítimos que simplesmente não moram neste nível. A primeira
 * versão desta instrução pedia exatamente esses quatro, e o resultado medido foi
 * um briefing inteiro de perguntas de campanha na criação do agente: o usuário
 * respondia, e nada tinha onde ser guardado. A regra completa vive na seção
 * `information_level` da Master Policy, que esta chamada carrega.
 *
 * As perguntas saem do MODELO, não de uma tabela por profissão: um
 * `if (papel === 'vendedor')` mataria a tese do produto e envelheceria no dia
 * seguinte. O que é fixo em CÓDIGO é só a pergunta de iniciativa — ela vale para
 * todo agente e a resposta muda a configuração inteira, então não pode depender
 * de o modelo lembrar de fazê-la.
 */

const briefingSchema = z.object({
  /**
   * Playbook de ofício que cobre este papel, ou vazio.
   *
   * Classificar sai no MESMO turno que planeja as perguntas: é uma decisão
   * semântica curta, e uma chamada só para ela dobraria a espera antes de o
   * usuário poder responder qualquer coisa.
   */
  playbookKey: z.string().trim().max(60).default(''),
  questions: z
    .array(
      z.object({
        /** A pergunta, em português de negócio. Sem jargão de IA. */
        question: z.string().trim().min(5).max(160),
        /** Por que isso muda o agente. É o que torna a pergunta respondível. */
        why: z.string().trim().min(5).max(200),
        /** Exemplo de resposta, para o usuário entender a granularidade. */
        placeholder: z.string().trim().max(120).default(''),
      }),
    )
    .max(4)
    .default([]),
});

export interface BriefingQuestion {
  id: string;
  question: string;
  why: string;
  placeholder: string;
  /** `CHOICE` tem opções fechadas; `TEXT` é resposta livre. */
  kind: 'TEXT' | 'CHOICE';
  options?: Array<{ value: string; label: string; hint: string }>;
}

export interface PlanBriefingResult {
  questions: BriefingQuestion[];
  /** Playbook que vai guiar a criação, quando algum cobre o papel. */
  playbookKey: string | null;
  /** Nome legível do playbook — a tela diz ao usuário em que o OS vai se basear. */
  playbookLabel: string | null;
  costMicros: number;
  totalTokens: number;
}

/**
 * Pergunta fixa, em código.
 *
 * Vale para TODO agente e a resposta muda personalidade, comportamento e
 * estratégia de uma vez — quem aborda primeiro trabalha diferente de quem
 * responde. Deixar isso a cargo do modelo seria aceitar que às vezes ele
 * esquece, e o agente nasceria com metade do comportamento indefinido.
 */
export const INITIATOR_QUESTION: BriefingQuestion = {
  id: 'initiator',
  question: 'Quem começa a conversa?',
  why: 'Muda o comportamento inteiro: abordar primeiro e responder quando chamado são ofícios diferentes.',
  placeholder: '',
  kind: 'CHOICE',
  options: [
    {
      value: 'USER',
      label: 'A pessoa',
      hint: 'Ele espera ser abordado — atendimento, suporte, tira-dúvidas.',
    },
    {
      value: 'AGENT',
      label: 'O agente',
      hint: 'Ele puxa o assunto — prospecção, recepção ativa, qualificação.',
    },
  ],
};

/**
 * Pergunta fixa, em código — mesma razão da iniciativa: é FATO, não
 * julgamento, e "o modelo escolhe um nome humano" sem sinal nenhum do
 * negócio é a causa provável de sair sempre o mesmo nome. Resposta em
 * branco é uma resposta válida — o modelo deriva do negócio/setor (ver
 * `CREATE_AGENT`), não de um nome humano genérico.
 */
export const NAME_QUESTION: BriefingQuestion = {
  id: 'name',
  question: 'Como você quer chamar o agente?',
  why: 'É o nome que aparece para quem conversa com ele. Deixe em branco e o sistema escolhe um, coerente com o negócio.',
  placeholder: 'Ex.: Ana, Carlos, Sankar Bot — ou deixe em branco',
  kind: 'TEXT',
};

/**
 * Pergunta fixa, em código — recurso NATIVO do agente (respostas
 * recomendadas), não um ajuste de conteúdo que caberia ao modelo decidir
 * sozinho no meio da criação. Mesma razão da iniciativa: liga/desliga muda
 * o comportamento inteiro do runtime, e não pode depender de o modelo
 * lembrar de traduzir a escolha em mutação.
 */
export const SUGGESTED_REPLIES_QUESTION: BriefingQuestion = {
  id: 'suggestedReplies',
  question: 'Quer que ele sugira respostas estratégicas durante a conversa?',
  why: 'Quando fizer sentido, ele oferece 2 a 4 opções curtas para conduzir — nunca em toda mensagem.',
  placeholder: '',
  kind: 'CHOICE',
  options: [
    { value: 'YES', label: 'Sim', hint: 'Ele sugere quando for estratégico.' },
    { value: 'NO', label: 'Não', hint: 'Ele só responde, sem sugerir opções.' },
  ],
};

function buildInstruction(catalog: string): string {
  return [
    'O usuário quer criar um AGENTE para o papel abaixo. Você tem duas tarefas.',
    '',
    '========== TAREFA 1: CLASSIFICAR ==========',
    '',
    'Existem playbooks de ofício cadastrados. Um playbook é a baseline profissional',
    'de um papel — o que um excelente profissional daquela área faz. Quando um',
    'cobre o papel pedido, o sistema já sabe projetar o agente e NÃO precisa',
    'perguntar quase nada.',
    '',
    'Catálogo:',
    catalog,
    '',
    'Devolva em `playbookKey` a chave do playbook que cobre este papel, copiada',
    'EXATAMENTE como aparece acima. Julgue pelo que o papel FAZ, não pelas',
    'palavras: "consultor de soluções para clínicas" é venda; "recepcionista que',
    'agenda consultas" não é.',
    '',
    'Na dúvida entre dois, escolha o mais específico. Se nenhum cobrir, devolva',
    'string vazia — forçar um playbook que não serve produziria um agente com o',
    'ofício errado, que é pior que um agente genérico.',
    '',
    'SE VOCÊ DEVOLVER UMA CHAVE, devolva `questions` VAZIO: as perguntas daquele',
    'papel já estão curadas no playbook e as suas seriam descartadas.',
    '',
    '========== TAREFA 2: PERGUNTAR (só se nenhum playbook cobrir) ==========',
    '',
    'Aí sim você precisa saber o que só o usuário sabe SOBRE O AGENTE.',
    '',
    'Este é o nível da ESPECIALIZAÇÃO: em que ele é especialista, onde opera e até',
    'onde pode ir sozinho. É a base dele, e vale em qualquer projeto e qualquer',
    'campanha — que ainda nem existem quando estas perguntas são feitas.',
    '',
    'Faça de 2 a 4 perguntas. TODAS precisam passar neste teste:',
    '',
    '  "a resposta continuaria valendo se este mesmo agente fosse usado em outra',
    '   campanha, de outro produto, para outro público?"',
    '',
    'Se não continuaria, a pergunta é de campanha e não cabe aqui.',
    '',
    'O que costuma caber — adapte ao papel, não copie a lista:',
    '',
    '  · o SETOR ou nicho em que ele atua — muda vocabulário, objeção típica e o',
    '    que é considerado normal naquele mercado;',
    '  · o CANAL onde ele fala — muda tamanho, formato e ritmo de cada mensagem;',
    '  · a FRONTEIRA de autonomia: o que ele nunca decide ou promete sozinho, e em',
    '    que momento passa a conversa para uma pessoa;',
    '  · como ele se APRESENTA: em nome de quem fala e quão formal é o tratamento.',
    '',
    'O que NUNCA cabe:',
    '',
    '  · qual produto ele oferece e por quanto          (é da CAMPANHA)',
    '  · quem é o cliente ideal daquela oferta          (é da CAMPANHA)',
    '  · qual o desconto ou prazo máximo autorizado     (é da CAMPANHA)',
    '  · qual o diferencial competitivo da empresa      (é do PROJETO)',
    '  · que tom usar, como tratar objeção, que skills ele precisa ter',
    '    (é OFÍCIO: seu trabalho, nunca pergunta)',
    '',
    'Cada pergunta precisa de um `why` que diga, em uma linha, o que muda no agente',
    'conforme a resposta. Sem isso o usuário responde no escuro.',
    '',
    'Português, linguagem de negócio, sem jargão de IA. Uma pergunta por assunto —',
    'quatro perguntas parecidas cansam e produzem a mesma resposta quatro vezes.',
    '',
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'Confira as duas coisas: a chave que você escolheu existe no catálogo acima,',
    'copiada sem alterar? E cada pergunta passa no teste do nível — se a resposta',
    'dependeria da campanha, troque-a antes de responder.',
  ].join('\n');
}

/**
 * O que o modelo precisa saber para perguntar bem.
 *
 * `information_level` é o que impede o briefing de derivar para campanha, e
 * `craft` é o que impede o oposto: perguntar ofício, que é o trabalho delegado.
 * As duas vêm do banco, versionadas — não são cópia local que envelhece.
 */
const BRIEFING_POLICY_SECTIONS = ['core', 'information_level', 'craft'];

export class PlanAgentBriefingUseCase {
  constructor(
    private readonly deps: {
      gateway: LlmGateway;
      policies: PolicyRepository;
      playbooks: PlaybookRepository;
    },
  ) {}

  /**
   * Resolve a chave que o modelo devolveu contra o catálogo REAL.
   *
   * O modelo pode inventar uma chave plausível, e uma chave inventada faria o
   * sistema anunciar um ofício que ele não tem. Só vale o que existe no banco.
   */
  private async resolve(key: string, catalog: AgentPlaybook[]): Promise<AgentPlaybook | null> {
    const trimmed = key.trim();
    if (!trimmed) return null;
    return catalog.find((playbook) => playbook.key === trimmed) ?? null;
  }

  /** As perguntas curadas do playbook, mais a de iniciativa, que é fixa. */
  private assemble(
    asked: Array<{ question: string; why: string; placeholder: string }>,
  ): BriefingQuestion[] {
    return [
      // A iniciativa vem PRIMEIRO: é a que o usuário decide sem pensar, e
      // começar por uma escolha de dois botões tira o peso do formulário.
      INITIATOR_QUESTION,
      // Nome e respostas recomendadas são FATO/liga-desliga, não julgamento
      // de ofício — vêm logo depois, antes das perguntas de especialização.
      NAME_QUESTION,
      SUGGESTED_REPLIES_QUESTION,
      ...asked.map((item, index) => ({
        id: `q${index}`,
        question: item.question,
        why: item.why,
        placeholder: item.placeholder,
        kind: 'TEXT' as const,
      })),
    ];
  }

  async execute(
    context: TenantContext,
    role: string,
    /** Tipo já escolhido na tela, quando o usuário clicou num dos cadastrados. */
    playbookKey?: string,
  ): Promise<PlanBriefingResult> {
    // Tipo escolhido é classificação JÁ FEITA — por uma pessoa, o que é melhor
    // que por um modelo. E como as perguntas daquele papel são curadas, não
    // sobra nada para o modelo decidir: a tela responde na hora, de graça, e
    // sem depender de o provider estar disponível. Este caminho existe porque
    // o contrário falhou na prática: três travadas seguidas do Gemini fizeram o
    // usuário esperar 78s por três perguntas que já estavam escritas no banco.
    if (playbookKey && !playbookKey.startsWith(CORE_PLAYBOOK_KEY)) {
      const chosen = await this.deps.playbooks.findByKey(playbookKey);
      if (chosen?.worthAsking.length) {
        return {
          questions: this.assemble(chosen.worthAsking),
          playbookKey: chosen.key,
          playbookLabel: chosen.label,
          costMicros: 0,
          totalTokens: 0,
        };
      }
    }

    const policy = await this.deps.policies.getCurrent(MASTER_POLICY_NAME);
    // O piso de conduta não é um papel entre outros: mostrá-lo ao
    // classificador convidaria o modelo a escolhê-lo quando nada mais coubesse,
    // e o agente nasceria sem ofício nenhum.
    const catalog = (await this.deps.playbooks.listCurrent()).filter(
      (playbook) => playbook.key !== CORE_PLAYBOOK_KEY,
    );

    const policyBlocks = BRIEFING_POLICY_SECTIONS.flatMap((section, index) => {
      const content = policy?.sections[section];
      if (!content) return [];
      return [
        {
          id: `policy.${section}`,
          kind: 'STABLE' as const,
          trust: 'TRUSTED' as const,
          priority: 100 - index,
          cacheable: true,
          content,
        },
      ];
    });

    const generated = await this.deps.gateway.generateStructured(
      context,
      {
        // Perguntar bem exige julgamento, mas é uma saída curta: o papel rápido
        // dá conta e custa uma fração do de raciocínio.
        role: 'hub.fast',
        blocks: [
          ...policyBlocks,
          {
            id: 'briefing.instruction',
            kind: 'STABLE' as const,
            trust: 'TRUSTED' as const,
            priority: 90,
            cacheable: true,
            content: buildInstruction(
              describeCatalogForPrompt(catalog.map((playbook) => toCatalogEntry(playbook))),
            ),
          },
        ],
        messages: [{ role: 'user', content: `Papel pretendido: ${role}` }],
        // Idem conversa: declarar `thinkingBudget` liga o raciocínio em vez
        // de limitá-lo. Ver a nota em `provider.ts`.
        params: { temperature: 0.4 },
        tokenBudget: 4_000,
        ...(policy ? { policyVersionId: policy.id } : {}),
        policySections: BRIEFING_POLICY_SECTIONS,
      },
      briefingSchema,
    );

    const playbook = await this.resolve(generated.content.playbookKey, catalog);

    // Papel sem playbook é a pauta do admin: sem este registro a lacuna é
    // invisível — o agente nasce genérico e ninguém fica sabendo que faltou.
    if (!playbook) await this.deps.playbooks.recordMiss(context, role);

    // Com playbook, as perguntas vêm CURADAS dele. Deixá-las a cargo do modelo
    // seria perguntar de novo o que o ofício já responde — e variar a cada
    // chamada, num passo que precisa ser estável (§31).
    const asked = playbook?.worthAsking.length ? playbook.worthAsking : generated.content.questions;

    return {
      questions: this.assemble(asked),
      playbookKey: playbook?.key ?? null,
      playbookLabel: playbook?.label ?? null,
      costMicros: generated.costMicros,
      totalTokens: generated.totalTokens,
    };
  }
}
