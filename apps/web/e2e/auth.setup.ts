import { expect, test as setup } from '@playwright/test';
import { E2E_ADMIN, STORAGE_STATE } from './fixtures';

/**
 * O login acontece UMA vez, e o resto da suíte reusa a sessão.
 *
 * Não é otimização: o limite de autenticação é de 20 tentativas por 15 minutos,
 * e ele existe porque essa é a superfície de força bruta e de enumeração de
 * usuários. Logar em cada teste esbarrava nele — e a suíte falhava por um
 * mecanismo de segurança funcionando exatamente como deveria.
 *
 * Afrouxar o limite para o teste passar seria testar um produto que não existe.
 *
 * O login em si continua coberto, e pela TELA: os testes do portão em
 * `jornada.spec.ts` entram sem sessão e provam o caminho inteiro, inclusive a
 * credencial errada.
 */
setup('autentica uma vez e guarda a sessão', async ({ page }) => {
  await page.goto('/entrar');

  await page.getByLabel('E-mail').fill(E2E_ADMIN.email);
  await page.getByLabel('Senha').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('navigation', { name: 'Navegação da seção' })).toBeVisible();

  // O cookie é httpOnly e vive na origem do preview, porque o proxy do Vite faz
  // a API ser same-origin — o mesmo arranjo do desenvolvimento.
  await page.context().storageState({ path: STORAGE_STATE });
});
