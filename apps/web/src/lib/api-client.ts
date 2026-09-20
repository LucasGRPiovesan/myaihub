import type { ApiErrorBody, ErrorCode } from '@myaihub/shared';

/**
 * Cliente HTTP da API.
 *
 * Em dev o Vite faz proxy de /api para a API, então tudo é same-origin e os
 * cookies httpOnly de sessão funcionam sem afrouxar SameSite.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly requestId: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Renova a sessão no máximo uma vez por vez. Sem isso, várias queries expirando
 * ao mesmo tempo disparariam refreshes concorrentes — e como o refresh token é
 * rotativo, o segundo seria interpretado como reuso e derrubaria a sessão.
 */
export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Libera na próxima volta do event loop para que chamadas simultâneas
      // ainda compartilhem esta tentativa.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

/**
 * A API não respondeu — não está no ar, ou o proxy não a alcançou.
 *
 * Distinguir isto de "a API respondeu um erro" importa: em desenvolvimento a
 * causa quase sempre é ter subido só o frontend, e uma mensagem genérica manda
 * a pessoa procurar o problema no lugar errado.
 */
const UNREACHABLE_MESSAGE =
  'Não foi possível falar com a API. Ela está rodando? Use `npm run dev` para subir api e web juntos.';

async function execute<T>(path: string, options: RequestOptions, allowRetry: boolean): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('INTERNAL_ERROR', UNREACHABLE_MESSAGE, 0, '');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const code = payload?.error.code ?? 'INTERNAL_ERROR';

  // QUALQUER 401, não só `TOKEN_EXPIRED`.
  //
  // O cookie de acesso expira junto com o token, então o browser o apaga e a
  // requisição seguinte chega SEM token — o servidor responde
  // `UNAUTHENTICATED`, não `TOKEN_EXPIRED`. Renovar só no segundo caso deixava
  // o usuário ser deslogado com um refresh token de 30 dias válido no bolso.
  if (response.status === 401 && allowRetry) {
    if (await refreshSession()) {
      return execute<T>(path, options, false);
    }
  }

  // Sem envelope JSON, a resposta não veio da nossa API: é o proxy do Vite
  // devolvendo o erro dele porque não alcançou o backend.
  const message =
    payload?.error.message ??
    (response.status >= 500 ? UNREACHABLE_MESSAGE : 'Falha na requisição.');

  throw new ApiError(
    code,
    message,
    response.status,
    payload?.error.requestId ?? '',
    payload?.error.details,
  );
}

export function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return execute<T>(path, options, true);
}
