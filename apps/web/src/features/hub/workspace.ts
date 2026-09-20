import type { CanonicalAgent, CanonicalCampaign, CanonicalProjectProfile } from '@myaihub/shared';
import type { QuickAction } from './contextual-actions';

/**
 * O que o painel SABE sobre o que está na tela (§28, §31).
 *
 * O MyAIHub é um sistema operacional, não uma caixa de chat: ele precisa dizer
 * onde você está, o que já existe e o que falta — antes de você perguntar. Um
 * painel que só espera comando transfere para o usuário o trabalho de descobrir
 * qual é o próximo passo, que é exatamente o trabalho que ele delegou aqui.
 *
 * Tudo isto é derivado em CÓDIGO a partir de dados que a tela já carregou.
 * Perguntar ao modelo "o que falta neste projeto?" custaria tokens e latência
 * para responder algo que um `if` responde — e responderia diferente a cada vez.
 */

export interface WorkspaceFact {
  label: string;
  value: string;
  /** Destaca o que está zerado: é onde mora o próximo passo. */
  empty?: boolean;
}

export interface WorkspaceGap {
  id: string;
  message: string;
  /** Ação que resolve esta lacuna, quando existe uma. */
  action?: QuickAction;
  /** `true` quando bloqueia algo (publicar, por exemplo). */
  blocking?: boolean;
}

export interface WorkspaceSummary {
  title: string;
  subtitle?: string;
  facts: WorkspaceFact[];
  gaps: WorkspaceGap[];
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`;
}

// -----------------------------------------------------------------------------
// Projeto
// -----------------------------------------------------------------------------

export interface ProjectWorkspaceInput {
  name: string;
  versionNumber: number | null;
  profile: CanonicalProjectProfile | null;
  campaignCount: number;
  publishedCount: number;
}

export function projectWorkspace(input: ProjectWorkspaceInput): WorkspaceSummary {
  const profile = input.profile;
  const audiences = profile?.audiences.length ?? 0;
  const offerings = profile?.offerings.length ?? 0;
  const differentiators = profile?.differentiators.length ?? 0;
  const businessRules = profile?.businessRules.length ?? 0;

  const gaps: WorkspaceGap[] = [];

  // A ordem importa: é a ordem em que o usuário deve resolver. Público antes de
  // campanha porque uma campanha sem público conhecido vira estratégia genérica.
  if (audiences === 0) {
    gaps.push({
      id: 'audience',
      message: 'O projeto ainda não descreve para quem o negócio fala.',
      action: {
        id: 'define-audience',
        label: 'Definir o público',
        operation: 'project.refine_profile',
        prompt: 'Nosso público é ',
      },
    });
  }

  if (offerings === 0) {
    gaps.push({
      id: 'offering',
      message: 'Nenhuma oferta registrada — é o que o agente vai propor.',
      action: {
        id: 'define-offering',
        label: 'Descrever as ofertas',
        operation: 'project.refine_profile',
        prompt: 'Oferecemos ',
      },
    });
  }

  if (differentiators === 0 && offerings > 0) {
    gaps.push({
      id: 'differentiator',
      message: 'Sem diferenciais, o agente não tem argumento próprio.',
      action: {
        id: 'define-differentiator',
        label: 'Registrar diferenciais',
        operation: 'project.refine_profile',
        prompt: 'O que nos diferencia é ',
      },
    });
  }

  // Regra de negócio antes de campanha: é a única faceta do perfil que muda o
  // COMPORTAMENTO do agente, e uma campanha publicada sem ela congela um agente
  // livre para prometer o que o negócio não cumpre.
  if (businessRules === 0 && offerings > 0) {
    gaps.push({
      id: 'business-rule',
      message:
        'Nenhuma regra de negócio. É o que impede o agente de prometer o que o negócio não cumpre.',
      action: {
        id: 'define-business-rule',
        label: 'Definir regras',
        operation: 'project.refine_profile',
        prompt: 'Regra que vale para qualquer agente deste projeto: ',
      },
    });
  }

  if (input.campaignCount === 0) {
    gaps.push({
      id: 'campaign',
      message: 'Nenhuma campanha ainda. É a campanha que coloca um agente em campo.',
      action: {
        id: 'create-campaign',
        label: 'Criar campanha',
        operation: 'campaign.create',
        prompt: 'Quero uma campanha para ',
      },
    });
  }

  return {
    title: input.name,
    ...(input.versionNumber ? { subtitle: `perfil v${input.versionNumber}` } : {}),
    facts: [
      { label: 'públicos', value: String(audiences), empty: audiences === 0 },
      { label: 'ofertas', value: String(offerings), empty: offerings === 0 },
      {
        label: 'regras',
        value: String(businessRules),
        empty: businessRules === 0,
      },
      {
        label: 'campanhas',
        value:
          input.publishedCount > 0
            ? `${input.campaignCount} · ${input.publishedCount} no ar`
            : String(input.campaignCount),
        empty: input.campaignCount === 0,
      },
    ],
    gaps,
  };
}

// -----------------------------------------------------------------------------
// Agente
// -----------------------------------------------------------------------------

export interface AgentWorkspaceInput {
  name: string;
  versionNumber: number | null;
  config: CanonicalAgent | null;
  campaignCount: number;
}

export function agentWorkspace(input: AgentWorkspaceInput): WorkspaceSummary {
  const config = input.config;
  const skills = config?.skills.length ?? 0;
  const communication = config?.communication.length ?? 0;
  const rules = (config?.hardRules.length ?? 0) + (config?.limits.length ?? 0);

  const gaps: WorkspaceGap[] = [];

  if (!config?.objective.primary) {
    gaps.push({
      id: 'objective',
      message: 'O agente não tem objetivo: ele não sabe o que está tentando alcançar.',
      action: {
        id: 'define-objective',
        label: 'Definir objetivo',
        operation: 'agent.configure',
        prompt: 'O objetivo dele é ',
      },
    });
  }

  if (communication === 0) {
    gaps.push({
      id: 'communication',
      message: 'Sem regras de comunicação, o tom fica por conta do modelo.',
      action: {
        id: 'communication',
        label: 'Ajustar comunicação',
        operation: 'agent.configure',
        prompt: 'Quero ajustar a forma como ele se comunica: ',
      },
    });
  }

  if (rules === 0) {
    gaps.push({
      id: 'limits',
      message: 'Nenhum limite definido — nada impede o agente de prometer o que não pode.',
      action: {
        id: 'rule',
        label: 'Definir limites',
        operation: 'agent.configure',
        prompt: 'Ele nunca pode ',
      },
    });
  }

  if (input.campaignCount === 0) {
    gaps.push({
      id: 'unused',
      message: 'Este agente não está em nenhuma campanha, então ainda não fala com ninguém.',
    });
  }

  return {
    title: input.name,
    ...(input.versionNumber ? { subtitle: `configuração v${input.versionNumber}` } : {}),
    facts: [
      { label: 'skills', value: String(skills), empty: skills === 0 },
      { label: 'comunicação', value: String(communication), empty: communication === 0 },
      { label: 'regras', value: String(rules), empty: rules === 0 },
    ],
    gaps,
  };
}

// -----------------------------------------------------------------------------
// Campanha
// -----------------------------------------------------------------------------

export interface CampaignWorkspaceInput {
  name: string;
  versionNumber: number | null;
  strategy: CanonicalCampaign | null;
  agentName: string | null;
  status: string;
  /** Vem do servidor, calculado no MESMO código que recusa a publicação. */
  publishBlockers: string[];
}

export function campaignWorkspace(input: CampaignWorkspaceInput): WorkspaceSummary {
  const strategy = input.strategy;
  const audience = strategy?.audience.length ?? 0;
  const discovery = strategy?.discoveryDimensions.length ?? 0;
  const rules = strategy?.rules.length ?? 0;

  const gaps: WorkspaceGap[] = [];

  if (!input.agentName) {
    // Sem ação de painel: vincular agente é um clique na tela, não uma conversa.
    gaps.push({
      id: 'agent',
      message: 'Nenhum agente vinculado. Escolha um em "Agente", aqui na página.',
      blocking: true,
    });
  }

  if (discovery === 0) {
    gaps.push({
      id: 'discovery',
      message:
        'A campanha não diz o que descobrir antes de propor — é isso que separa ' +
        'uma conversa consultiva de um panfleto.',
      action: {
        id: 'discovery',
        label: 'Definir o que descobrir',
        operation: 'campaign.refine_strategy',
        prompt: 'Antes de propor, o agente precisa descobrir ',
      },
      blocking: true,
    });
  }

  if (audience === 0) {
    gaps.push({
      id: 'audience',
      message: 'Sem público definido, a estratégia vale para qualquer um — e para ninguém.',
      action: {
        id: 'audience',
        label: 'Ajustar público',
        operation: 'campaign.refine_strategy',
        prompt: 'Esta campanha fala com ',
      },
    });
  }

  if (!strategy?.cta.enabled) {
    gaps.push({
      id: 'cta',
      message: 'Sem chamada para ação, a conversa não tem desfecho.',
    });
  }

  // Bloqueio que o servidor conhece e a tela não deduziria sozinha.
  for (const blocker of input.publishBlockers) {
    const known = gaps.some((gap) => gap.blocking);
    if (!known || !blocker.includes('agente')) {
      if (!gaps.some((gap) => gap.message === blocker)) {
        gaps.push({ id: `server:${blocker}`, message: blocker, blocking: true });
      }
    }
  }

  return {
    title: input.name,
    subtitle: input.agentName
      ? `${input.agentName}${input.versionNumber ? ` · v${input.versionNumber}` : ''}`
      : 'sem agente vinculado',
    facts: [
      { label: 'público', value: String(audience), empty: audience === 0 },
      { label: 'a descobrir', value: String(discovery), empty: discovery === 0 },
      { label: 'regras', value: String(rules), empty: rules === 0 },
    ],
    gaps,
  };
}

// -----------------------------------------------------------------------------
// Raiz
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Playbook
// -----------------------------------------------------------------------------

/**
 * O estado do PLAYBOOK, não o da conta.
 *
 * Antes esta tela caía no workspace da raiz e o painel dizia "0 projetos, 1
 * agente · comece pelo projeto" enquanto o admin editava um ofício da
 * plataforma — e ainda oferecia "Criar projeto" como primeira ação, que foi
 * exatamente o botão que disparou a operação errada.
 *
 * As lacunas aqui são as do ofício: sem limites o agente nasce desprotegido;
 * sem perguntas curadas o briefing volta a inventar as dele a cada criação.
 */
export function playbookWorkspace(input: {
  label: string;
  versionNumber: number;
  principles: number;
  limits: number;
  questions: number;
  byFacet: Array<{ facet: string; count: number }>;
}): WorkspaceSummary {
  const gaps: WorkspaceGap[] = [];

  if (input.limits === 0) {
    gaps.push({
      id: 'playbook-limits',
      message: 'Sem limites: o agente deste papel nasce sem as proteções do ofício.',
      action: {
        id: 'limit',
        label: 'Acrescentar um limite',
        operation: 'playbook.refine',
        prompt: 'Ele nunca pode ',
      },
    });
  }

  if (input.questions === 0) {
    gaps.push({
      id: 'playbook-questions',
      message:
        'Sem perguntas curadas: o briefing pede ao modelo que invente as dele, e a resposta muda a cada criação.',
      action: {
        id: 'question',
        label: 'Definir as perguntas',
        operation: 'playbook.refine',
        prompt: 'No briefing deste papel, pergunte ',
      },
    });
  }

  return {
    title: input.label,
    subtitle: `versão ${input.versionNumber} · vale para todo agente deste papel`,
    facts: [
      { label: 'princípios', value: String(input.principles) },
      { label: 'limites', value: String(input.limits) },
      { label: 'perguntas', value: String(input.questions) },
      ...input.byFacet.map((entry) => ({ label: entry.facet, value: String(entry.count) })),
    ],
    gaps,
  };
}

export function rootWorkspace(input: {
  projectCount: number;
  agentCount: number;
}): WorkspaceSummary {
  const gaps: WorkspaceGap[] = [];

  if (input.projectCount === 0) {
    gaps.push({
      id: 'project',
      message: 'Comece pelo projeto: é ele que descreve o negócio que o agente vai representar.',
      action: {
        id: 'create-project',
        label: 'Criar projeto',
        operation: 'project.create_from_brief',
        prompt: 'Meu negócio é ',
      },
    });
  } else if (input.agentCount === 0) {
    gaps.push({
      id: 'agent',
      message: 'Nenhum agente ainda. É quem vai conversar com o público das campanhas.',
      action: {
        id: 'create-agent',
        label: 'Criar agente',
        operation: 'agent.create',
        prompt: 'Quero um agente que ',
      },
    });
  }

  return {
    title: 'MyAIHub',
    facts: [
      {
        label: plural(input.projectCount, 'projeto', 'projetos'),
        value: '',
        empty: input.projectCount === 0,
      },
      {
        label: plural(input.agentCount, 'agente', 'agentes'),
        value: '',
        empty: input.agentCount === 0,
      },
    ],
    gaps,
  };
}

/**
 * Ações do contexto, REORDENADAS pelo estado.
 *
 * O que resolve uma lacuna vem primeiro, na ordem em que as lacunas devem ser
 * resolvidas. Um painel que oferece "configurar CTA" antes de "definir o que
 * descobrir" está sugerindo o acabamento antes da fundação.
 */
export function prioritizeActions(
  workspace: WorkspaceSummary,
  fallback: QuickAction[],
): QuickAction[] {
  const fromGaps = workspace.gaps
    .map((gap) => gap.action)
    .filter((action): action is QuickAction => Boolean(action));

  const seen = new Set(fromGaps.map((action) => action.id));
  return [...fromGaps, ...fallback.filter((action) => !seen.has(action.id))];
}

/** Micros de USD para leitura humana no painel. */
export function formatCost(micros: number): string {
  if (micros === 0) return 'sem custo';
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return `US$ ${dollars.toFixed(4)}`;
  return `US$ ${dollars.toFixed(2)}`;
}
