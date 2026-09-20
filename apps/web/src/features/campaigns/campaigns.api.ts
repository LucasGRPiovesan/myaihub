import type { CanonicalCampaign } from '@myaihub/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

export type CampaignStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';

export interface CampaignListItem {
  id: string;
  projectId: string;
  agentId: string | null;
  name: string;
  slug: string;
  status: CampaignStatus;
  publicId: string | null;
  createdAt: string;
  heroImageUrl: string | null;
}

export interface CampaignDetail extends CampaignListItem {
  lockVersion: number;
  agent: { id: string; name: string; role: string } | null;
  strategy: {
    versionNumber: number;
    canonical: CanonicalCampaign;
    summary: string[];
    createdAt: string;
  } | null;
  /** O que impede publicar. Calculado no servidor, no mesmo código que recusa. */
  publishBlockers: string[];
  activeDeployment: {
    id: string;
    deploymentNumber: number;
    manifestHash: string;
    publishedAt: string;
  } | null;
}

export interface CampaignVersion {
  id: string;
  versionNumber: number;
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: string;
}

export interface Deployment {
  id: string;
  deploymentNumber: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'PAUSED';
  manifestHash: string;
  publishedAt: string;
  supersededAt: string | null;
}

export const campaignKeys = {
  all: ['campaigns'] as const,
  byProject: (projectId: string) => ['campaigns', { projectId }] as const,
  detail: (id: string) => ['campaigns', id] as const,
  versions: (id: string) => ['campaigns', id, 'versions'] as const,
  deployments: (id: string) => ['campaigns', id, 'deployments'] as const,
};

export function useProjectCampaigns(projectId: string | undefined) {
  return useQuery({
    queryKey: campaignKeys.byProject(projectId ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: CampaignListItem[] }>(
        `/api/campaigns?projectId=${projectId}`,
      );
      return items;
    },
    enabled: Boolean(projectId),
  });
}

/** Campanhas de um agente — responde "onde este agente está atuando?". */
export function useAgentCampaigns(agentId: string | undefined) {
  return useQuery({
    queryKey: ['campaigns', { agentId }] as const,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: CampaignListItem[] }>(
        `/api/campaigns?agentId=${agentId}`,
      );
      return items;
    },
    enabled: Boolean(agentId),
  });
}

export function useCampaign(id: string | undefined): UseQueryResult<CampaignDetail> {
  return useQuery({
    queryKey: campaignKeys.detail(id ?? ''),
    queryFn: () => apiRequest<CampaignDetail>(`/api/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useCampaignVersions(id: string | undefined): UseQueryResult<CampaignVersion[]> {
  return useQuery({
    queryKey: campaignKeys.versions(id ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: CampaignVersion[] }>(
        `/api/campaigns/${id}/versions`,
      );
      return items;
    },
    enabled: Boolean(id),
  });
}

export function useDeployments(id: string | undefined): UseQueryResult<Deployment[]> {
  return useQuery({
    queryKey: campaignKeys.deployments(id ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: Deployment[] }>(
        `/api/campaigns/${id}/deployments`,
      );
      return items;
    },
    enabled: Boolean(id),
  });
}

export function useBindAgent(campaignId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string | null) =>
      apiRequest<CampaignListItem>(`/api/campaigns/${campaignId}/agent`, {
        method: 'PUT',
        body: { agentId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) });
      void queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

export function usePublishCampaign(campaignId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiRequest<{ deploymentNumber: number; publicId: string; manifestHash: string }>(
        `/api/campaigns/${campaignId}/deployments`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) });
      void queryClient.invalidateQueries({ queryKey: campaignKeys.deployments(campaignId) });
      void queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
  });
}

/** Invalida depois de uma operação do OS, que altera por fora do Query. */
export function useRefreshCampaigns(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: campaignKeys.all });
  };
}
