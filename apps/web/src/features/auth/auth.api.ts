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
      // A ORDEM importa. `clear()` destrói toda Query do cache — inclusive a
      // de `authKeys.me` que o AuthenticatedApp está observando NA HORA — e
      // um `setQueryData` depois disso cria uma Query NOVA, sem observador
      // nenhum ligado a ela: a tela nunca sabia que devia trocar para a de
      // login. Medido: `getQueryData` já voltava `null`, e a UI seguia
      // mostrando a conta antiga até um F5 (a sessão real já tinha morrido
      // no servidor, então recarregar sempre "consertava").
      //
      // `setQueryData` primeiro atualiza a Query EXISTENTE, então quem já
      // está inscrito nela recebe o `null` e desmonta. Só depois é seguro
      // limpar o resto do cache — por isso adiado a uma microtask, depois de
      // qualquer notificação que o próprio `setQueryData` tenha agendado.
      queryClient.setQueryData(authKeys.me, null);
      queueMicrotask(() => queryClient.clear());

      // O transcrito do painel some AQUI, no logout EXPLÍCITO.
      //
      // Antes ele era apagado por inferência — "havia usuário, agora não há" —
      // e qualquer piscada da sessão passava por logout: duplicar uma aba
      // zerava a conversa. Sair é um ato; inferi-lo de uma ausência é adivinhar.
      forgetHubHistory();
    },
  });
}
