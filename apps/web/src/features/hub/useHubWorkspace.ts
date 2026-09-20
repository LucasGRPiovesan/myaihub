import { usePlaybook } from '../admin/admin.api';
import { useAgent, useAgents } from '../agents/agents.api';
import { useAgentCampaigns, useCampaign, useProjectCampaigns } from '../campaigns/campaigns.api';
import { useProject, useProjects } from '../projects/projects.api';
import type { HubScope } from './contextual-actions';
import {
  agentWorkspace,
  campaignWorkspace,
  projectWorkspace,
  playbookWorkspace,
  rootWorkspace,
  type WorkspaceSummary,
} from './workspace';

/**
 * Estado do que está na tela, para o painel.
 *
 * As queries são as MESMAS que a página já faz — o TanStack Query devolve do
 * cache, sem requisição extra. O painel não tem uma visão paralela da verdade:
 * ele lê a mesma que o usuário está olhando.
 */
export function useHubWorkspace(scope: HubScope, scopeId?: string): WorkspaceSummary {
  const projects = useProjects();
  const agents = useAgents();

  const project = useProject(scope === 'PROJECT' ? scopeId : undefined);
  const projectCampaigns = useProjectCampaigns(scope === 'PROJECT' ? scopeId : undefined);

  const agent = useAgent(scope === 'AGENT' ? scopeId : undefined);
  const agentCampaigns = useAgentCampaigns(scope === 'AGENT' ? scopeId : undefined);

  const campaign = useCampaign(scope === 'CAMPAIGN' ? scopeId : undefined);
  const playbook = usePlaybook(scope === 'PLAYBOOK' ? scopeId : undefined);

  if (scope === 'PROJECT' && project.data) {
    const list = projectCampaigns.data ?? [];
    return projectWorkspace({
      name: project.data.name,
      versionNumber: project.data.profile?.versionNumber ?? null,
      profile: project.data.profile?.canonical ?? null,
      campaignCount: list.length,
      publishedCount: list.filter((item) => item.status === 'PUBLISHED').length,
    });
  }

  if (scope === 'AGENT' && agent.data) {
    return agentWorkspace({
      name: agent.data.name,
      versionNumber: agent.data.configuration?.versionNumber ?? null,
      config: agent.data.configuration?.canonical ?? null,
      campaignCount: agentCampaigns.data?.length ?? 0,
    });
  }

  if (scope === 'CAMPAIGN' && campaign.data) {
    return campaignWorkspace({
      name: campaign.data.name,
      versionNumber: campaign.data.strategy?.versionNumber ?? null,
      strategy: campaign.data.strategy?.canonical ?? null,
      agentName: campaign.data.agent?.name ?? null,
      status: campaign.data.status,
      publishBlockers: campaign.data.publishBlockers,
    });
  }

  if (scope === 'PLAYBOOK' && playbook.data) {
    const byFacet = new Map<string, number>();
    for (const principle of playbook.data.playbook.principles) {
      byFacet.set(principle.facet, (byFacet.get(principle.facet) ?? 0) + 1);
    }

    return playbookWorkspace({
      label: playbook.data.playbook.label,
      versionNumber: playbook.data.history[0]?.versionNumber ?? 1,
      principles: playbook.data.playbook.principles.length,
      limits: playbook.data.playbook.antiPatterns.length,
      questions: playbook.data.playbook.worthAsking.length,
      byFacet: [...byFacet.entries()].map(([facet, count]) => ({ facet, count })),
    });
  }

  return rootWorkspace({
    projectCount: projects.data?.length ?? 0,
    agentCount: agents.data?.length ?? 0,
  });
}
