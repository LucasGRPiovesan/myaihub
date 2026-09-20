import type { CanonicalProjectProfile } from '@myaihub/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

export interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'ARCHIVED';
  lockVersion: number;
  profile: {
    versionNumber: number;
    canonical: CanonicalProjectProfile;
    summary: string[];
    createdAt: string;
  } | null;
}

export const projectKeys = {
  all: ['projects'] as const,
  detail: (id: string) => ['projects', id] as const,
  versions: (id: string) => ['projects', id, 'versions'] as const,
};

export function useProjects(): UseQueryResult<ProjectListItem[]> {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const { items } = await apiRequest<{ items: ProjectListItem[] }>('/api/projects');
      return items;
    },
  });
}

export function useProject(id: string | undefined): UseQueryResult<ProjectDetail> {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ''),
    queryFn: () => apiRequest<ProjectDetail>(`/api/projects/${id}`),
    enabled: Boolean(id),
  });
}

export interface ProjectVersion {
  id: string;
  versionNumber: number;
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: string;
}

export function useProjectVersions(id: string | undefined): UseQueryResult<ProjectVersion[]> {
  return useQuery({
    queryKey: projectKeys.versions(id ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: ProjectVersion[] }>(
        `/api/projects/${id}/versions`,
      );
      return items;
    },
    enabled: Boolean(id),
  });
}

/**
 * Invalida o cache depois de uma operação do OS.
 *
 * O OS altera projetos por fora do TanStack Query (via SSE), então a lista e o
 * detalhe precisam ser reconsultados quando a operação termina — senão a tela
 * fica mostrando o estado anterior à mudança que o usuário acabou de ver
 * acontecer no painel.
 */
export function useRefreshProjects(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: projectKeys.all });
  };
}
