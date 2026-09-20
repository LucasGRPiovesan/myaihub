import {
  AGENT_FACET_SLUGS,
  PROJECT_FACET_SLUGS,
  type AgentFacet,
  type AuthenticatedUser,
  type ProjectFacet,
} from '@myaihub/shared';
import { LogOut, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Button, IconButton, cx } from '../design-system/primitives';
import { Sheet } from '../design-system/Sheet';
import { ThemeToggle } from '../design-system/ThemeToggle';
import { QuotaBadge } from '../features/models/QuotaBadge';
import { useLogout } from '../features/auth/auth.api';
import { useAgent } from '../features/agents/agents.api';
import { useAgentCampaigns, useCampaign } from '../features/campaigns/campaigns.api';
import { HubPanel } from '../features/hub/HubPanel';
import { useHub } from '../features/hub/HubProvider';
import { useProject, useProjects } from '../features/projects/projects.api';
import { usePlaybook } from '../features/admin/admin.api';
import { HubLauncher } from './HubLauncher';
import { StackedSidebar } from './navigation/StackedSidebar';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;

    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

function AccountFooter({ user }: { user: AuthenticatedUser }) {
  const logout = useLogout();

  return (
    <div className="mt-auto border-t border-border p-3.5">
      <p className="truncate text-sm font-medium">{user.name}</p>
      <p className="truncate text-[13px] text-text-subtle">{user.activeAccount.name}</p>
      <Button
        variant="ghost"
        className="mt-2.5 h-9 w-full justify-start px-2 text-[15px]"
        loading={logout.isPending}
        onClick={() => logout.mutate()}
      >
        <LogOut aria-hidden className="size-5" />
        Sair
      </Button>
    </div>
  );
}

export function AppShell({ user }: { user: AuthenticatedUser }) {
  const { state, close } = useHub();
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [navOpen, setNavOpen] = useState(false);
  // Ler um rationale longo em 25% de tela é ruim; alargar é escolha do usuário,
  // e não algo que o painel deva decidir sozinho no meio da leitura.
  const [panelExpanded, setPanelExpanded] = useState(false);
  // Alimenta a saudação e as quick actions do painel — sem chamada ao LLM (§31).
  const { data: projects } = useProjects();
  const hasProjects = (projects?.length ?? 0) > 0;

  // A sidebar empilhada mostra o NOME do projeto e da campanha, não os ids da
  // URL. Sem o nome da campanha, o nível 2 dizia só "Campanha" — e quem tem
  // várias não sabia em qual estava.
  const activeProjectId = /^\/projetos\/([^/]+)/.exec(pathname)?.[1];
  const activeProjectName = projects?.find((project) => project.id === activeProjectId)?.name;
  const { data: activeProject } = useProject(activeProjectId);
  const activeCampaignId = /^\/projetos\/[^/]+\/campanhas\/([^/]+)/.exec(pathname)?.[1];
  const { data: activeCampaign } = useCampaign(activeCampaignId);
  const activeAgentId = /^\/agentes\/([^/]+)/.exec(pathname)?.[1];
  const { data: activeAgent } = useAgent(activeAgentId);
  const activePlaybookKey = /^\/admin\/playbooks\/(?!novo)([^/]+)/.exec(pathname)?.[1];
  const { data: activePlaybook } = usePlaybook(activePlaybookKey);
  const { data: agentCampaigns } = useAgentCampaigns(activeAgentId);
  const agentFacetCounts = activeAgent?.configuration
    ? (Object.fromEntries(
        (Object.keys(AGENT_FACET_SLUGS) as AgentFacet[]).map((facet) => [
          facet,
          activeAgent.configuration?.canonical[facet].length ?? 0,
        ]),
      ) as Partial<Record<AgentFacet, number>>)
    : undefined;
  // O mesmo contador das facetas do agente, para as seções do perfil. Ver a
  // seção vazia na sidebar é o que faz o usuário saber que ela existe.
  const projectFacetCounts = activeProject?.profile
    ? (Object.fromEntries(
        (Object.keys(PROJECT_FACET_SLUGS) as ProjectFacet[]).map((facet) => [
          facet,
          activeProject.profile?.canonical[facet].length ?? 0,
        ]),
      ) as Partial<Record<ProjectFacet, number>>)
    : undefined;
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  // No mobile a navegação é um drawer sobreposto: mantê-lo aberto depois de
  // navegar esconderia justamente a tela para a qual o usuário acabou de ir.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    /*
      O shell é PRESO À VIEWPORT, e a rolagem acontece só dentro das regiões.

      `h-full`, NUNCA `h-dvh`: html/body/#root já declaram `height: 100%`
      (styles.css) — a cadeia inteira usa a MESMA unidade, porcentagem, que é
      estável. `dvh` é recalculado pelo browser em certos eventos de scroll,
      resize e troca de layout, e pode dessincronizar do resto da cadeia bem
      depois de uma navegação pesada — o shell encolhe, e o vão que sobra
      embaixo mostra o fundo cru do `body` (quase preto no tema escuro). Foi
      isso que quebrou o layout "do nada" ao clicar num link do painel: nada
      no clique em si, qualquer navegação que disparasse o recálculo bastava.
    */
    <div className="flex h-full overflow-hidden">
      {isDesktop && (
        <aside className="flex w-[clamp(13rem,20%,18rem)] shrink-0 flex-col border-r border-border bg-surface">
          <StackedSidebar
            context={{
              projectName: activeProjectName,
              campaignName: activeCampaign?.name,
              agentName: activeAgent?.name,
              agentCampaigns,
              agentFacetCounts,
              projectFacetCounts,
              isAdmin: user.role === 'ADMIN',
              playbookName: activePlaybook?.playbook.label,
            }}
          />
          <AccountFooter user={user} />
        </aside>
      )}

      {!isDesktop && (
        <Sheet open={navOpen} onClose={() => setNavOpen(false)} title="Navegação" hideTitle>
          <div className="flex h-full flex-col">
            <StackedSidebar
              context={{
                projectName: activeProjectName,
                campaignName: activeCampaign?.name,
                agentName: activeAgent?.name,
                agentCampaigns,
                agentFacetCounts,
                projectFacetCounts,
                isAdmin: user.role === 'ADMIN',
                playbookName: activePlaybook?.playbook.label,
              }}
            />
            <AccountFooter user={user} />
          </div>
        </Sheet>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <div className="flex items-center gap-2">
            {!isDesktop && (
              <IconButton
                label="Abrir navegação"
                className="size-10"
                onClick={() => setNavOpen(true)}
              >
                <Menu aria-hidden className="size-5" />
              </IconButton>
            )}
          </div>

          {/*
            O MyAIHub NÃO é chamado daqui. Existe uma porta só, o botão
            flutuante — duas portas para a mesma coisa é o começo de dois
            comportamentos diferentes para a mesma coisa.
          */}
          <div className="flex items-center gap-2">
            {/* Só em desenvolvimento: de qual bolso a chamada está saindo. */}
            <QuotaBadge isAdmin={user.role === 'ADMIN'} />
            <ThemeToggle large />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            className={cx(
              'min-h-0 min-w-0 flex-1 overflow-auto p-6',
              'transition-[flex-basis] duration-300 ease-[var(--ease-out-soft)]',
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>

      {/*
        O painel ocupa a ALTURA INTEIRA da tela, ao lado da topbar e não abaixo
        dela. Ele é o sistema operacional do produto, não um utilitário de uma
        página: espremê-lo sob a barra da aplicação dizia o contrário — e comia
        56px de conversa, que é justamente o que se lê ali.

        Continua retraindo para ~25% e sumindo quando não é necessário: aberto
        como decoração ele seria só uma coluna a menos para trabalhar (§28, §30).
      */}
      {isDesktop && state.open && (
        <aside
          className={cx(
            'h-full min-h-0 shrink-0 border-l border-border bg-surface',
            'transition-[width] duration-300 ease-[var(--ease-out-soft)]',
            panelExpanded ? 'w-[clamp(24rem,42%,40rem)]' : 'w-[clamp(20rem,25%,24rem)]',
          )}
        >
          <HubPanel
            firstName={firstName}
            hasProjects={hasProjects}
            expanded={panelExpanded}
            onToggleExpand={() => setPanelExpanded((value) => !value)}
          />
        </aside>
      )}

      <HubLauncher />

      {!isDesktop && (
        <Sheet open={state.open} onClose={close} side="right" title="MyAIHub" hideTitle>
          <HubPanel firstName={firstName} hasProjects={hasProjects} onClose={close} />
        </Sheet>
      )}
    </div>
  );
}
