import { expect, test } from '@playwright/test';

/**
 * Credenciais e sessão compartilhada do E2E.
 *
 * A senha está aqui em claro de propósito: é a do `.env.e2e`, versionado, de um
 * banco descartável que só existe na máquina de quem roda os testes. Segredo de
 * verdade nunca entra em arquivo de teste — e nenhum destes vale em lugar
 * nenhum além do `myaihub_e2e`.
 */
export const E2E_ADMIN = {
  email: 'e2e@myaihub.local',
  password: 'E2ePlaywright@123',
};

/**
 * Onde a sessão autenticada fica.
 *
 * Fora do repositório: é estado de execução, não fonte. Em `test-results/`, que
 * já é ignorado pelo git e limpo entre execuções.
 */
export const STORAGE_STATE = 'test-results/.auth/admin.json';

/**
 * Contexto SEM sessão, para os testes do portão de autenticação.
 *
 * Precisa ser explícito porque a configuração aplica o `storageState` a todos:
 * sem isto, o teste que verifica o redirecionamento para o login entraria já
 * logado e passaria sem provar nada.
 */
export const SEM_SESSAO = { storageState: { cookies: [], origins: [] } };

export { expect, test };
