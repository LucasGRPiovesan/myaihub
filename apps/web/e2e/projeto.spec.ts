import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * As telas do PROJETO que a Fase 5 completou: identidade e conhecimento.
 *
 * O que só o navegador prova: o formulário salva de verdade — passa pela
 * mutação tipada, cria versão nova e o valor volta do servidor. Um teste de
 * unidade sobre o componente provaria que o `onChange` funciona, que não é a
 * pergunta que interessa.
 */

/**
 * O projeto de FIXTURE, semeado por `npm run e2e:setup`.
 *
 * Criar pelo OS dentro do teste transformaria um teste sobre TELAS num teste
 * sobre o dublê: no E2E o provider é o FAKE, e a criação de projeto passa por
 * saída estruturada do modelo. A criação de verdade é coberta pela suíte de
 * integração, contra o runner real.
 */
async function projetoDeFixture(page: Page): Promise<string> {
  const resposta = await page.request.get('/api/projects');
  expect(resposta.status()).toBe(200);

  const { items } = (await resposta.json()) as {
    items: Array<{ id: string; name: string; slug: string }>;
  };

  const projeto = items.find((item) => item.slug === 'projeto-e2e');
  expect(projeto, 'rode `npm run e2e:setup` antes do E2E').toBeDefined();

  return projeto!.id;
}
test.describe('identidade de marca', () => {
  test('salva pela tela e volta do servidor', async ({ page }) => {
    const projectId = await projetoDeFixture(page);

    await page.goto(`/projetos/${projectId}/identidade`);
    await expect(page.getByRole('heading', { name: 'Identidade' })).toBeVisible();

    await page.getByLabel('Nome exibido').fill('Metal E2E Atendimento');
    await page.getByLabel('Tagline').fill('Peças sob medida para a indústria');
    await page.getByRole('button', { name: 'Salvar identidade' }).click();

    await expect(page.getByText('Salvo como versão nova.')).toBeVisible();

    // Recarrega: o valor precisa vir do BANCO, não do estado local que acabou
    // de ser digitado. Sem esta volta, o teste provaria só que o input aceita
    // texto.
    await page.reload();
    await expect(page.getByLabel('Nome exibido')).toHaveValue('Metal E2E Atendimento');
  });

  test('a prévia mostra a PÁGINA que o público vai ver, não só a faixa do topo', async ({
    page,
  }) => {
    const projectId = await projetoDeFixture(page);

    await page.goto(`/projetos/${projectId}/identidade`);

    // É o único documento do sistema cujo efeito é visual: "#1f6feb sobre
    // #ffffff" em texto não responde à pergunta que o usuário está fazendo.
    await expect(page.getByText(/Prévia da página de atendimento/)).toBeVisible();

    // A prévia mostrava só o cabeçalho, e era honesta enquanto a página
    // pública também só pintava o cabeçalho. Agora que a marca veste a página
    // inteira — fundo, balão, componente —, uma prévia do topo esconderia
    // justamente o que passou a depender destes campos.
    await expect(page.getByText('Como funciona')).toBeVisible();
    await expect(page.getByText('Preciso de um orçamento')).toBeVisible();

    // A paleta inteira é editável: sem estes campos a página pública não tinha
    // como ser a do cliente, e caía nos tokens do MyAIHub fora do cabeçalho.
    // Exato: o seletor de cor tem `aria-label` "Escolher fundo da página", e o
    // localizador frouxo casaria com os dois.
    await expect(page.getByLabel('Fundo da página', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Fonte do texto', { exact: true })).toBeVisible();
  });

  test('o painel oferece as ações da MARCA, não as do perfil', async ({ page }) => {
    const projectId = await projetoDeFixture(page);

    await page.goto(`/projetos/${projectId}/identidade`);
    await page
      .getByRole('button', { name: /Ajustar/ })
      .first()
      .click();

    await expect(page.getByText('Ajustar o tom de voz')).toBeVisible();
    // Oferecer "Informar sobre o negócio" aqui é o tipo de ação fora de lugar
    // que já disparou a operação errada com o id certo de outra coisa.
    await expect(page.getByText('Informar sobre o negócio')).toHaveCount(0);
  });
});

test.describe('conhecimento', () => {
  test('cadastra um texto e ele fica indexado', async ({ page }) => {
    const projectId = await projetoDeFixture(page);

    await page.goto(`/projetos/${projectId}/conhecimento`);
    await expect(page.getByRole('heading', { name: 'Conhecimento' })).toBeVisible();

    // Título ÚNICO por execução. O banco do E2E não é truncado entre
    // execuções — é uma fixture, não uma suíte de integração —, e um título
    // fixo faria a segunda rodada casar com a fonte da primeira. O teste
    // passaria sem ter criado nada.
    const titulo = `Política de troca ${Date.now()}`;

    await page.getByRole('radio', { name: 'Texto' }).check({ force: true });
    await page.getByLabel('Título').fill(titulo);
    await page.getByLabel('Conteúdo').fill('Aceitamos troca em até 30 dias corridos da entrega.');
    await page.getByRole('button', { name: 'Adicionar' }).click();

    // A asserção é dentro do ITEM, não solta na página: o estado da fonte
    // pertence a ela, e um `getByText` global casaria com qualquer outra.
    const item = page.getByRole('listitem').filter({ hasText: titulo });

    await expect(item).toBeVisible();
    await expect(item.getByText(/indexada · r1/)).toBeVisible();
    await expect(item.getByText(/caracteres/)).toBeVisible();
  });

  test('a tela avisa que a publicação CONGELA o conteúdo', async ({ page }) => {
    const projectId = await projetoDeFixture(page);

    await page.goto(`/projetos/${projectId}/conhecimento`);

    // Sem este aviso, a primeira vez que alguém reindexar e não vir diferença
    // no ar vai parecer um bug.
    await expect(page.getByText(/congeladas/)).toBeVisible();
  });
});

/**
 * O recarregamento não pode apagar o atendimento.
 *
 * É a promessa central da Fase 8, e ela estava cumprida pela METADE: o servidor
 * persistia a conversa, mas o `sessionId` vivia na memória do React — um F5
 * perdia o ponteiro e a tela voltava vazia, com o atendimento inteiro no banco.
 *
 * Este teste existe porque a falha é invisível pelo lado do servidor: os testes
 * de integração provavam a persistência e passavam verdes o tempo todo.
 */
test.describe('a conversa sobrevive ao recarregamento', () => {
  // Um turno do modelo, o recarregamento e a restauração não cabem no teto
  // padrão de 30s da suíte — e o teto do TESTE vence o da asserção.
  test.setTimeout(120_000);

  test('o Lab retoma o teste de onde parou', async ({ page }) => {
    const projectId = await projetoDeFixture(page);

    await page.goto(`/projetos/${projectId}/testar`);

    // Pelo PROJETO o contexto já existe, então não há cenário a preencher.
    //
    // Localizado pelo NOME acessível, nunca por posição: o painel do MyAIHub
    // também tem um campo de texto no DOM, e `.last()` acertava ele — o teste
    // digitava num lugar que ninguém vê e falhava sem dizer por quê.
    const composer = page.getByRole('textbox', { name: 'Falar com o agente' });
    await composer.waitFor({ state: 'visible', timeout: 20_000 });

    const pergunta = `sobrevive ao reload ${Date.now()}`;

    // Espera o TURNO INTEIRO, não só a fala aparecer na tela.
    //
    // A mensagem do usuário é otimista: ela pinta antes de o servidor gravar
    // qualquer coisa. Recarregar aí é recarregar no meio do voo — e foi assim
    // que este teste falhou primeiro, acusando a restauração de um problema
    // que era dele.
    const turno = page.waitForResponse(
      (resposta) => resposta.url().includes('/test') && resposta.request().method() === 'POST',
    );

    await composer.fill(pergunta);
    await composer.press('Enter');

    expect((await turno).status()).toBe(200);
    await expect(page.getByText(pergunta)).toBeVisible({ timeout: 30_000 });

    await page.reload();

    // Sem a restauração, isto falha com a tela vazia — que era exatamente o
    // estado anterior à correção.
    await expect(page.getByText(pergunta)).toBeVisible({ timeout: 30_000 });
  });
});
