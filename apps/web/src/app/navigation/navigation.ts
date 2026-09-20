import {
  AGENT_FACET_LABELS,
  AGENT_FACET_SLUGS,
  PROJECT_FACET_LABELS,
  PROJECT_FACET_SLUGS,
  type AgentFacet,
  type ProjectFacet,
} from '@myaihub/shared';
import {
  Activity,
  Ban,
  BarChart3,
  Boxes,
  BookOpen,
  FlaskConical,
  Gem,
  Globe,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  Package,
  Palette,
  Route,
  Settings,
  ShieldCheck,
  Sparkles,
  Smile,
  Target,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Navegação empilhada (§29).
 *
 * A sidebar muda conforme a PROFUNDIDADE da rota — raiz, projeto, campanha —
 * como uma navegação em pilha. O nível é derivado da URL, nunca de estado
 * paralelo: assim um refresh, um deep link ou o botão voltar do browser
 * produzem exatamente a mesma sidebar.
 *
 * Todo item aqui tem rota. Alguns levam a um estado vazio que diz em que fase a
 * seção chega — o que é honesto. Item sem rota nenhuma NÃO é: ele caía no
 * catch-all e devolvia o usuário para a Visão Geral, dando a impressão de que o
 * clique não funcionou.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Casamento exato — evita que a raiz fique ativa em todas as subrotas. */
  end?: boolean;
  /**
   * Contador ao lado do item.
   *
   * Numa lista de sete facetas, saber quais estão vazias sem entrar em cada uma
   * é a diferença entre navegar e caçar.
   */
  badge?: number;
}

export interface NavLevel {
  /** Chave estável do nível; a animação de transição usa isto. */
  id: string;
  depth: 0 | 1 | 2;
  title: string;
  back?: { to: string; label: string };
  items: NavItem[];
}

export interface NavContext {
  /** Nome do projeto atual. Ausente enquanto carrega; o id serve de fallback. */
  projectName?: string | undefined;
  campaignName?: string | undefined;
  agentName?: string | undefined;
  /** Quantos itens cada faceta do agente tem, para o contador da sidebar. */
  agentFacetCounts?: Partial<Record<AgentFacet, number>> | undefined;
  /** O mesmo para as facetas do projeto. */
  projectFacetCounts?: Partial<Record<ProjectFacet, number>> | undefined;
  /** Campanhas em que o agente atua — viram os itens do nível dele. */
  agentCampaigns?: Array<{ id: string; name: string; projectId: string }> | undefined;
  /** Administração da plataforma só existe para quem administra a plataforma. */
  isAdmin?: boolean | undefined;
  /** Nome do playbook aberto. Ausente enquanto carrega; a chave serve de rótulo. */
  playbookName?: string | undefined;
}

const PROJECT_ROUTE = /^\/projetos\/([^/]+)/;
const CAMPAIGN_ROUTE = /^\/projetos\/([^/]+)\/campanhas\/([^/]+)/;
const AGENT_ROUTE = /^\/agentes\/([^/]+)/;
// A listagem (`/admin/playbooks`) pertence à raiz; só um playbook ESPECÍFICO
// empilha. `novo` fica de fora: é um fluxo de criação, não um playbook aberto.
const PLAYBOOK_ROUTE = /^\/admin\/playbooks\/(?!novo)([^/]+)/;

function rootLevel(context: NavContext): NavLevel {
  return {
    id: 'root',
    depth: 0,
    title: 'MyAIHub',
    items: [
      { to: '/', label: 'Visão Geral', icon: LayoutGrid, end: true },
      { to: '/projetos', label: 'Projetos', icon: Boxes },
      { to: '/agentes', label: 'Agentes', icon: Users },
      // O que aconteceu com gente de verdade, na conta inteira. Fica na raiz
      // porque a pergunta "está funcionando?" não é de um projeto só.
      { to: '/resultados', label: 'Resultados', icon: BarChart3 },
      // Configuração da PLATAFORMA, não da conta: quem usa o produto não tem o
      // que fazer aqui, e mostrar o item a ele seria prometer uma porta fechada.
      ...(context.isAdmin
        ? [
            { to: '/admin/playbooks', label: 'Playbooks', icon: BookOpen } as NavItem,
            // O que o S.O não conseguiu fazer por limite do SISTEMA: a pauta de
            // correção do próprio MyAIHub.
            { to: '/admin/suporte', label: 'Suporte', icon: LifeBuoy } as NavItem,
            // Chave e liga/desliga de cada provedor de IA — a PLATAFORMA
            // inteira, como o resto desta seção.
            { to: '/admin/provedores', label: 'Provedores', icon: KeyRound } as NavItem,
          ]
        : []),
    ],
  };
}

/** Ícone de cada faceta do perfil. Mesma razão dos ícones do agente. */
const PROJECT_FACET_ICONS: Record<ProjectFacet, LucideIcon> = {
  offerings: Package,
  audiences: Users,
  valuePropositions: Gem,
  differentiators: Sparkles,
  market: TrendingUp,
  businessRules: ShieldCheck,
};

/**
 * A ordem das seções do perfil na sidebar.
 *
 * É a ordem de leitura de quem precisa entender um negócio: o que ele vende,
 * para quem, por que escolhem, o que o distingue, contra quem disputa, e sob
 * que regras opera. Regras de negócio por último porque é a que GOVERNA o
 * resto — e a única que atravessa para o prompt do agente.
 */
const PROJECT_FACET_ORDER: ProjectFacet[] = [
  'offerings',
  'audiences',
  'valuePropositions',
  'differentiators',
  'market',
  'businessRules',
];

/**
 * O nível do projeto: as seis facetas do perfil viram ROTAS.
 *
 * Mesma decisão das facetas do agente e das seções do playbook. Seis seções
 * numa página só é a rolagem de dois mil pixels que já foi erro aqui uma vez:
 * sem nível na sidebar, não há como saber onde se está nem chegar direto.
 */
function projectLevel(projectId: string, context: NavContext): NavLevel {
  const base = `/projetos/${projectId}`;
  return {
    id: `project:${projectId}`,
    depth: 1,
    title: context.projectName ?? 'Projeto',
    back: { to: '/projetos', label: 'Projetos' },
    items: [
      { to: base, label: 'Visão Geral', icon: LayoutGrid, end: true },
      ...PROJECT_FACET_ORDER.map((facet) => ({
        to: `${base}/${PROJECT_FACET_SLUGS[facet]}`,
        label: PROJECT_FACET_LABELS[facet],
        icon: PROJECT_FACET_ICONS[facet],
        badge: context.projectFacetCounts?.[facet] ?? 0,
      })),
      { to: `${base}/campanhas`, label: 'Campanhas', icon: Megaphone },
      // O teste com o NEGÓCIO inteiro por trás — sem o recorte de uma
      // campanha, e sem obrigar o usuário a inventar um cenário à mão.
      { to: `${base}/testar`, label: 'Testar Agente', icon: FlaskConical },
      { to: `${base}/conhecimento`, label: 'Conhecimento', icon: BookOpen },
      { to: `${base}/identidade`, label: 'Identidade', icon: Palette },
      { to: `${base}/metricas`, label: 'Métricas', icon: BarChart3 },
      { to: `${base}/configuracoes`, label: 'Configurações', icon: Settings },
    ],
  };
}

function campaignLevel(projectId: string, campaignId: string, context: NavContext): NavLevel {
  const base = `/projetos/${projectId}/campanhas/${campaignId}`;
  return {
    id: `campaign:${campaignId}`,
    depth: 2,
    title: context.campaignName ?? 'Campanha',
    back: { to: `/projetos/${projectId}`, label: context.projectName ?? 'Projeto' },
    // Estratégia e histórico vivem NA visão geral da campanha, não em abas
    // próprias: separá-los obrigaria a navegar para conferir o que se acabou de
    // ajustar. Os itens restantes têm rota — nenhum clique cai no vazio.
    items: [
      { to: base, label: 'Visão Geral', icon: Target, end: true },
      { to: `${base}/testar`, label: 'Testar Agente', icon: FlaskConical },
      { to: `${base}/chat-publico`, label: 'Chat Público', icon: Globe },
      { to: `${base}/resultados`, label: 'Resultados', icon: BarChart3 },
    ],
  };
}

/** Ícone de cada faceta. Reconhecer pelo desenho é mais rápido que ler. */
const FACET_ICONS: Record<AgentFacet, LucideIcon> = {
  personality: Smile,
  communication: MessageSquare,
  skills: Wrench,
  behaviors: Activity,
  strategies: Route,
  hardRules: ShieldCheck,
  limits: Ban,
};

const FACET_ORDER = Object.keys(AGENT_FACET_SLUGS) as AgentFacet[];

/**
 * Nível do agente.
 *
 * As facetas viram itens de navegação, como as seções do projeto. São sete, e
 * cada uma cresce — numa página só o usuário rola metros para chegar em
 * "limites". O contador mostra o que está vazio sem precisar entrar.
 */
function agentLevel(agentId: string, context: NavContext): NavLevel {
  const campaigns = context.agentCampaigns ?? [];
  const counts = context.agentFacetCounts ?? {};

  return {
    id: `agent:${agentId}`,
    depth: 1,
    title: context.agentName ?? 'Agente',
    back: { to: '/agentes', label: 'Agentes' },
    items: [
      { to: `/agentes/${agentId}`, label: 'Visão Geral', icon: LayoutGrid, end: true },
      ...FACET_ORDER.map((facet) => ({
        to: `/agentes/${agentId}/${AGENT_FACET_SLUGS[facet]}`,
        label: AGENT_FACET_LABELS[facet],
        icon: FACET_ICONS[facet],
        badge: counts[facet] ?? 0,
      })),
      ...campaigns.map((campaign) => ({
        to: `/projetos/${campaign.projectId}/campanhas/${campaign.id}`,
        label: campaign.name,
        icon: Megaphone,
      })),
    ],
  };
}

/**
 * Um playbook aberto empilha, como projeto, campanha e agente.
 *
 * Cada seção tem ROTA própria — e é por isso que ela pode virar item de menu.
 * Item de sidebar que fosse âncora numa página longa mentiria sobre onde o
 * usuário está: voltar do navegador não desfaria a "navegação", e um deep link
 * não reconstituiria a tela.
 */
function playbookLevel(key: string, context: NavContext): NavLevel {
  const base = `/admin/playbooks/${key}`;
  return {
    id: `playbook:${key}`,
    depth: 1,
    title: context.playbookName ?? key,
    back: { to: '/admin/playbooks', label: 'Playbooks' },
    items: [
      { to: base, label: 'Visão geral', icon: LayoutGrid, end: true },
      { to: `${base}/principios`, label: 'Princípios', icon: Target },
      { to: `${base}/limites`, label: 'Nunca', icon: Ban },
      { to: `${base}/perguntas`, label: 'Perguntas', icon: MessageSquare },
      { to: `${base}/reconhecimento`, label: 'Reconhecido por', icon: Route },
      { to: `${base}/fontes`, label: 'Fontes', icon: BookOpen },
    ],
  };
}

export function resolveNavLevel(pathname: string, context: NavContext = {}): NavLevel {
  const playbook = PLAYBOOK_ROUTE.exec(pathname);
  if (playbook?.[1]) return playbookLevel(playbook[1], context);

  const agent = AGENT_ROUTE.exec(pathname);
  if (agent?.[1]) return agentLevel(agent[1], context);

  const campaign = CAMPAIGN_ROUTE.exec(pathname);
  if (campaign?.[1] && campaign[2]) {
    return campaignLevel(campaign[1], campaign[2], context);
  }

  const project = PROJECT_ROUTE.exec(pathname);
  // `/projetos` (a listagem) pertence à raiz; só um projeto ESPECÍFICO empilha.
  if (project?.[1]) {
    return projectLevel(project[1], context);
  }

  return rootLevel(context);
}

/**
 * Um item está ativo quando a rota atual é ele ou está abaixo dele.
 * Extraído para poder ser testado sem montar o Router.
 */
export function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
