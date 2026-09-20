import type { ProviderName } from '@myaihub/shared';

/**
 * Testa uma chave contra o provider de VERDADE — sem gastar token nenhum.
 *
 * Cada provider tem um endpoint de METADADO (listar modelos) que só exige
 * autenticação, nunca gera conteúdo: é a forma certa de responder "esta chave
 * funciona?" sem cobrar pela resposta. As três URLs são FIXAS, escritas aqui —
 * nunca construídas a partir de entrada do usuário, então isto não tem a
 * superfície de SSRF que `WebContentReader` tem contra site de terceiro.
 */

const TIMEOUT_MS = 8_000;

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

async function testarGemini(apiKey: string): Promise<ConnectionTestResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );

  if (response.ok) return { ok: true, message: 'Conectado — a chave é válida.' };
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return { ok: false, message: 'O Gemini rejeitou a chave (inválida ou sem permissão).' };
  }
  return { ok: false, message: `O Gemini respondeu ${response.status}.` };
}

async function testarOpenAi(apiKey: string): Promise<ConnectionTestResult> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.ok) return { ok: true, message: 'Conectado — a chave é válida.' };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'A OpenAI rejeitou a chave (inválida ou sem permissão).' };
  }
  return { ok: false, message: `A OpenAI respondeu ${response.status}.` };
}

async function testarAnthropic(apiKey: string): Promise<ConnectionTestResult> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.ok) return { ok: true, message: 'Conectado — a chave é válida.' };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'A Anthropic rejeitou a chave (inválida ou sem permissão).' };
  }
  return { ok: false, message: `A Anthropic respondeu ${response.status}.` };
}

export async function testProviderKey(
  provider: ProviderName,
  apiKey: string,
): Promise<ConnectionTestResult> {
  try {
    switch (provider) {
      case 'gemini':
        return await testarGemini(apiKey);
      case 'openai':
        return await testarOpenAi(apiKey);
      case 'anthropic':
        return await testarAnthropic(apiKey);
      case 'fake':
        return { ok: true, message: 'O provider de teste não precisa de chave.' };
    }
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      message: timeout
        ? 'O provider não respondeu a tempo.'
        : `Não foi possível conectar: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
    };
  }
}
