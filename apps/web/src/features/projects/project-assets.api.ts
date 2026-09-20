import type {
  CanonicalBrandIdentity,
  CreateKnowledgeSourceInput,
  KnowledgeSourceView,
} from '@myaihub/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';

/**
 * Marca e conhecimento do projeto (Fase 5).
 *
 * A marca é documento CANÔNICO e passa por mutação tipada — a mesma que o OS
 * usa. O conhecimento não: fonte é conteúdo do cliente, e mutá-la por modelo
 * devolveria paráfrase no lugar do texto dele.
 */

export interface BrandIdentityDetail {
  versionNumber: number;
  canonical: CanonicalBrandIdentity;
  summary: string[];
  gaps: string[];
  lockVersion: number;
}

export interface BrandMutationInput {
  displayName?: string;
  tagline?: string;
  primaryColor?: string;
  onPrimaryColor?: string;
  canvasColor?: string;
  surfaceColor?: string;
  textColor?: string;
  textMutedColor?: string;
  borderColor?: string;
  successColor?: string;
  dangerColor?: string;
  headingFamily?: string;
  bodyFamily?: string;
  fontSource?: CanonicalBrandIdentity['typography']['source'];
  shape?: CanonicalBrandIdentity['shape'];
  logoAssetId?: string | null;
  avatarAssetId?: string | null;
  tone?: CanonicalBrandIdentity['voice']['tone'];
  voiceGuidance?: string;
  avoid?: string[];
  legalFooter?: string;
}

export const assetKeys = {
  brand: (projectId: string) => ['projects', projectId, 'brand'] as const,
  knowledge: (projectId: string) => ['projects', projectId, 'knowledge'] as const,
};

export function useBrandIdentity(
  projectId: string | undefined,
): UseQueryResult<BrandIdentityDetail> {
  return useQuery({
    queryKey: assetKeys.brand(projectId ?? ''),
    queryFn: () => apiRequest<BrandIdentityDetail>(`/api/projects/${projectId}/brand`),
    enabled: Boolean(projectId),
  });
}

/**
 * Salva a marca por mutação tipada.
 *
 * Manda SÓ os campos que mudaram, e não o documento inteiro: o merge é do
 * servidor, e devolver tudo faria uma tela que não conhece um campo novo
 * apagá-lo sem que ninguém pedisse.
 */
export function useSaveBrandIdentity(
  projectId: string | undefined,
): UseMutationResult<BrandIdentityDetail, Error, { changes: BrandMutationInput; reason?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) =>
      apiRequest<BrandIdentityDetail>(`/api/projects/${projectId}/brand/mutations`, {
        method: 'POST',
        body: {
          mutations: [{ kind: 'SET_BRAND_IDENTITY', ...input.changes }],
          ...(input.reason ? { reason: input.reason } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assetKeys.brand(projectId ?? '') });
    },
  });
}

export function useKnowledgeSources(
  projectId: string | undefined,
): UseQueryResult<KnowledgeSourceView[]> {
  return useQuery({
    queryKey: assetKeys.knowledge(projectId ?? ''),
    queryFn: async () => {
      const { items } = await apiRequest<{ items: KnowledgeSourceView[] }>(
        `/api/projects/${projectId}/knowledge`,
      );
      return items;
    },
    enabled: Boolean(projectId),
  });
}

export function useCreateKnowledgeSource(
  projectId: string | undefined,
): UseMutationResult<KnowledgeSourceView, Error, CreateKnowledgeSourceInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) =>
      apiRequest<KnowledgeSourceView>(`/api/projects/${projectId}/knowledge`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assetKeys.knowledge(projectId ?? '') });
    },
  });
}

/**
 * Substituir o texto de uma fonte é criar REVISÃO, não editar a antiga.
 *
 * A revisão anterior continua existindo e continua sendo o que os
 * deployments já publicados servem — é isso que faz a publicação seguir
 * reproduzível depois de o cliente corrigir o texto.
 */
export function useReplaceKnowledgeText(
  projectId: string | undefined,
): UseMutationResult<KnowledgeSourceView, Error, { sourceId: string; content: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) =>
      apiRequest<KnowledgeSourceView>(`/api/projects/${projectId}/knowledge/${input.sourceId}`, {
        method: 'PUT',
        body: { content: input.content },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assetKeys.knowledge(projectId ?? '') });
    },
  });
}

export function useReindexKnowledgeSource(
  projectId: string | undefined,
): UseMutationResult<KnowledgeSourceView, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceId) =>
      apiRequest<KnowledgeSourceView>(`/api/projects/${projectId}/knowledge/${sourceId}/reindex`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assetKeys.knowledge(projectId ?? '') });
    },
  });
}

export function useDeleteKnowledgeSource(
  projectId: string | undefined,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceId) => {
      await apiRequest<void>(`/api/projects/${projectId}/knowledge/${sourceId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assetKeys.knowledge(projectId ?? '') });
    },
  });
}
