import type {
  AuthSessionResponse,
  AuthenticatedUser,
  LoginRequest,
  RegisterRequest,
} from '@myaihub/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../lib/api-client';
import { forgetHubHistory } from '../hub/hub-persistence';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

export function useCurrentUser(): UseQueryResult<AuthenticatedUser | null> {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async () => {
      try {
        const { user } = await apiRequest<{ user: AuthenticatedUser }>('/api/auth/me');
        return user;
      } catch (error) {
        // Não autenticado é um estado válido da aplicação, não um erro de query:
        // devolver null mantém a UI simples e evita retry/backoff inútil.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiRequest<AuthSessionResponse>('/api/auth/login', { method: 'POST', body: input }),
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.me, session.user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RegisterRequest) =>
      apiRequest<AuthSessionResponse>('/api/auth/register', { method: 'POST', body: input }),
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.me, session.user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiRequest<void>('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Limpa tudo: cache de outra conta jamais deve sobreviver a um logout.
      queryClient.clear();
      queryClient.setQueryData(authKeys.me, null);
      // O transcrito do painel some AQUI, no logout EXPLÍCITO.
      //
      // Antes ele era apagado por inferência — "havia usuário, agora não há" —
      // e qualquer piscada da sessão passava por logout: duplicar uma aba
      // zerava a conversa. Sair é um ato; inferi-lo de uma ausência é adivinhar.
      forgetHubHistory();
    },
  });
}
