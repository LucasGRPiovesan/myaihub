import { expect, SEM_SESSAO, test } from './fixtures';

/**
 * A jornada, no NAVEGADOR (§17 Fase 11).
 *
 * O que este arquivo cobre e a suíte de integração não alcança: rota, sessão
 * por cookie httpOnly, sidebar empilhada, formulário que salva de verdade, e a
 * página pública que uma pessoa de fora abre sem conta.
 *
 * Contra o provider FAKE. O que se testa aqui é a APLICAÇÃO — um E2E que
 * depende do Gemini falha por indisponibilidade alheia e vira ruído que
 * ninguém investiga.
 */
test.describe('jornada autenticada', () => {
  test('entra, navega e chega no projeto', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL('/projetos');
    await expect(page.getByRole('heading', { name: 'Projetos' })).toBeVisible();
  });

  test('a sessão SOBREVIVE ao recarregamento', async ({ page }) => {
    await page.goto('/');
    await page.reload();

    // O cookie é httpOnly: se o refresh não funcionasse pelo proxy, a página
    // cairia no login — que é exatamente a falha que só aparece no navegador.
    await expect(page.getByRole('navigation', { name: 'Navegação da seção' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/entrar/);
  });

  test('a raiz oferece Resultados, e a tela responde sem conversa nenhuma', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Resultados' }).click();

    await expect(page).toHaveURL('/resultados');
    await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();

    // Estado vazio HONESTO: a tela diz por que não há número, em vez de mostrar
    // zeros que pareceriam um produto quebrado.
    await expect(page.getByText(/Nenhuma conversa pública nesta janela/i)).toBeVisible();
  });

  test('a janela de tempo é fixa e trocável', async ({ page }) => {
    await page.goto('/resultados');

    await page.getByRole('button', { name: '7 dias' }).click();
    await expect(page.getByRole('button', { name: '7 dias' })).toBeVisible();
  });

  test('rota inexistente volta para a raiz em vez de tela branca', async ({ page }) => {
    await page.goto('/nao-existe');

    await expect(page).toHaveURL('/');
  });
});

test.describe('portão de autenticação', () => {
  // Contexto LIMPO: sem isto o teste entraria já logado e passaria sem
  // provar nada, porque a configuração aplica a sessão a todos os projetos.
  test.use(SEM_SESSAO);

  test('quem não entrou vai para o login', async ({ page }) => {
    await page.goto('/projetos');

    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('credencial errada não entra, e explica', async ({ page }) => {
    await page.goto('/entrar');

    await page.getByLabel('E-mail').fill('e2e@myaihub.local');
    await page.getByLabel('Senha').fill('senha-errada-de-proposito');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
  });

  /**
   * O chat público fica FORA do portão.
   *
   * Quem chega veio de um anúncio e não tem conta: cair no login seria o
   * produto pedindo cadastro para conversar. E endereço inexistente responde a
   * MESMA coisa que campanha despublicada — distinguir os dois contaria a quem
   * sonda o que existe do outro lado.
   */
  test('endereço público inexistente não pede login nem revela nada', async ({ page }) => {
    await page.goto('/c/01INEXISTENTE0000000000001');

    await expect(page).not.toHaveURL(/\/entrar/);
    await expect(page.getByText(/não está disponível/i)).toBeVisible();
  });
});
