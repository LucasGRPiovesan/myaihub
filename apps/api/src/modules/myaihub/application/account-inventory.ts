import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { AgentRepository } from '../../agents/domain/repositories.js';
import type { CampaignRepository } from '../../campaigns/domain/repositories.js';
import type { KnowledgeRepository } from '../../projects/domain/knowledge-repositories.js';
import type { ProjectRepository } from '../../projects/domain/repositories.js';
import type { PlaybookRepository } from '../domain/repositories.js';
import type { EntityKind } from '../domain/system-action.js';

/**
 * TUDO O QUE EXISTE NA CONTA, num lugar só.
 *
 * O S.O enxergava o que a ROTA lhe mostrava: na tela do agente ele sabia do
 * agente, na do projeto sabia do projeto. Isso fazia dele um assistente de
 * página, não um sistema operacional — e produzia respostas simplesmente
 * falsas, como afirmar que a conta não tinha agente nenhum porque nenhum estava
 * vinculado ao projeto aberto.
 *
 * O inventário é a base de duas capacidades que dependiam dele:
 *
 *   RESOLVER de quem o usuário está falando. "Cria uma campanha no Sankar"
 *   precisa virar um id, e o id não vem da URL — vem do NOME que ele escreveu.
 *
 *   RESPONDER sobre o conjunto. Comparar dois agentes, dizer o que falta em
 *   qual projeto, apontar a campanha sem agente: nada disso cabe num escopo.
 *
 * É LEITURA, sempre, e passa pelo tenant guard como qualquer outra consulta —
 * o inventário é da conta de quem perguntou, e de mais ninguém.
 */

export interface InventoryEntry {
  id: string;
  name: string;
  /** O que distingue esta entidade das outras do mesmo tipo. */
  detail: string;
  /** O projeto dono, para campanha e conhecimento: "vincula no projeto X" vira a campanha de X. */
  parentId?: string;
}

export interface AccountInventory {
  projects: InventoryEntry[];
  agents: InventoryEntry[];
  campaigns: InventoryEntry[];
  playbooks: InventoryEntry[];
  /**
   * Fontes de conhecimento dos projetos.
   *
   * Sem elas o S.O não tinha como atender "tira aquela página do conhecimento":
   * a ação existe na tela, e o id que ela precisa não estava em lugar nenhum
   * que ele enxergasse.
   */
  knowledge: InventoryEntry[];
}

/**
 * Teto por tipo.
 *
 * Sem teto, uma conta grande carregaria tudo em memória e o inventário
 * empurraria o resto do contexto para fora — o mesmo corte silencioso que já
 * derrubou o canônico do alvo uma vez. Vinte cobre a conta real e mantém o
 * bloco pequeno o bastante para caber ao lado de tudo mais.
 */
const LIMIT = 20;

export class AccountInventoryReader {
  constructor(
    private readonly deps: {
      projects: ProjectRepository;
      agents: AgentRepository;
      campaigns: CampaignRepository;
      playbooks: PlaybookRepository;
      knowledge: KnowledgeRepository;
    },
  ) {}

  async read(context: TenantContext): Promise<AccountInventory> {
    const [projects, agents, campaigns, playbooks, sources] = await Promise.all([
      this.deps.projects.list(context, LIMIT, null),
      this.deps.agents.list(context, LIMIT, null),
      this.deps.campaigns.list(context, {}, LIMIT, null),
      this.deps.playbooks.listCurrent(),
      this.deps.knowledge.listAccountSources(context, LIMIT),
    ]);

    const nomeDoProjeto = new Map(projects.map((project) => [project.id, project.name]));
    const nomeDoAgente = new Map(agents.map((agent) => [agent.id, agent.name]));

    return {
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        detail: project.status === 'ARCHIVED' ? 'projeto ARQUIVADO' : 'projeto ativo',
      })),
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        detail: agent.role,
      })),
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        parentId: campaign.projectId,
        name: campaign.name,
        // Projeto e agente juntos porque é assim que o usuário se refere a uma
        // campanha: "a de estamparia do Sankar", não pelo id.
        detail:
          `${campaign.status}, do projeto ${nomeDoProjeto.get(campaign.projectId) ?? '?'}` +
          (campaign.agentId
            ? `, conduzida por ${nomeDoAgente.get(campaign.agentId) ?? '?'}`
            : ', SEM agente vinculado'),
      })),
      playbooks: playbooks.map((playbook) => ({
        id: playbook.key,
        name: playbook.label,
        detail: 'ofício da plataforma',
      })),
      knowledge: sources.map((source) => ({
        id: source.id,
        parentId: source.projectId,
        name: source.title,
        detail:
          `${source.kind === 'URL' ? (source.uri ?? 'página') : 'texto colado'}, ${source.status}, do projeto ` +
          (nomeDoProjeto.get(source.projectId) ?? '?'),
      })),
    };
  }
}

/** O inventário como texto, para entrar num prompt. */
export function describeInventory(inventory: AccountInventory): string {
  const bloco = (titulo: string, entries: InventoryEntry[], vazio: string): string[] => {
    if (entries.length === 0) return [`${titulo}: ${vazio}`, ''];
    return [
      `${titulo}:`,
      ...entries.map((entry) => `  ${entry.id}  ${entry.name} — ${entry.detail}`),
      '',
    ];
  };

  return [
    ...bloco('PROJETOS DESTA CONTA', inventory.projects, 'nenhum ainda.'),
    ...bloco('AGENTES DESTA CONTA', inventory.agents, 'nenhum ainda.'),
    ...bloco('CAMPANHAS DESTA CONTA', inventory.campaigns, 'nenhuma ainda.'),
    ...bloco('OFÍCIOS DA PLATAFORMA', inventory.playbooks, 'nenhum cadastrado.'),
    ...bloco('CONHECIMENTO DOS PROJETOS', inventory.knowledge, 'nenhuma fonte.'),
  ]
    .join('\n')
    .trimEnd();
}

/**
 * O id existe, e é do TIPO que a operação espera?
 *
 * Esta é a defesa que substituiu a checagem de escopo da rota. Ela era contra
 * cliente com estado velho disparando a operação de uma tela com o id de outra;
 * agora quem escolhe o id é o S.O, e o risco muda de forma: o modelo pode
 * devolver um id que existe mas é de outra coisa — o de um agente onde se
 * esperava um projeto. O runner carregaria nada e o erro chegaria ao usuário
 * como "o item não foi encontrado", que não diz nada sobre a causa.
 *
 * Conferir contra o inventário resolve os dois de uma vez: id inventado não
 * está lá, e id do tipo errado está na lista errada.
 */
export function isKnownEntity(inventory: AccountInventory, kind: EntityKind, id: string): boolean {
  const lista = {
    PROJECT: inventory.projects,
    AGENT: inventory.agents,
    CAMPAIGN: inventory.campaigns,
    PLAYBOOK: inventory.playbooks,
    KNOWLEDGE: inventory.knowledge,
  }[kind];

  return lista.some((entry) => entry.id === id);
}
