import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './apps/web/e2e/fixtures';

/**
 * E2E (§17 Fase 11).
 *
 * O que o Playwright cobre e a suíte de integração NÃO alcança: o navegador de
 * verdade — rota, sessão por cookie httpOnly, sidebar empilhada, formulário que
 * salva, e a página pública que uma pessoa de fora abre sem conta.
 *
 * O provider é o FAKE, como em toda a suíte (invariante 8). O que se testa aqui
 * é a APLICAÇÃO, não o modelo: um E2E que depende do Gemini falha por
 * indisponibilidade alheia e vira ruído que ninguém investiga. A jornada contra
 * o provider real tem lugar próprio — `npm run smoke:journey`, e é ela que roda
 * quando se mexe em prompt, schema ou provider.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  // Um teste de navegador que passa de meio minuto está esperando algo que não
  // vai chegar — travar cedo diz onde, e travar tarde só custa a espera.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Sequencial de propósito: os testes compartilham UM banco, e paralelo
  // produziria deadlock e truncate cruzado — a mesma razão do `singleFork` da
  // suíte de integração.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    // Rastro só do que falhou: gravar tudo custa segundos por teste e produz
    // artefato que ninguém abre.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // O login roda UMA vez e a sessão é reusada. Não é economia de tempo: o
    // limite de autenticação é de 20 tentativas por 15 minutos, e ele existe
    // porque essa é a superfície de força bruta. Logar por teste esbarrava
    // nele — a suíte falhava por um mecanismo de segurança funcionando.
    //
    // Afrouxar o limite para o teste passar seria testar um produto que não
    // existe. O login pela tela continua coberto pelos testes do portão.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      // `tsx watch`, e não `tsx`: com `reuseExistingServer` o Playwright
      // reaproveita a API já no ar entre execuções, e sem o watch ela seguiria
      // servindo o código de antes da última correção. Custou um ciclo inteiro
      // de depuração aqui — o teste falhava contra um servidor velho, apontando
      // para um bug que já estava consertado.
      command: 'npm run e2e:api',
      // Porta 3334, não 3333: a API de desenvolvimento fica na 3333, e com
      // `reuseExistingServer` o Playwright a adotaria como se fosse a do E2E —
      // rodando os testes contra o banco de desenvolvimento.
      url: 'http://localhost:3334/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // O `vite preview` serve o `dist/`, e por isso `npm run e2e` BUILDA antes
      // de chamar o Playwright. Sem isso a suíte testa o build da última vez —
      // aconteceu aqui: o teste falhava contra uma tela que já estava corrigida,
      // e o snapshot mostrava um texto que não existia mais no código.
      //
      // É a mesma armadilha do `reuseExistingServer` na API, do outro lado.
      command: 'npm run e2e:web',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
