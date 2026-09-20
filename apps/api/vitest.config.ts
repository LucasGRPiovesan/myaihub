import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup-worker.ts'],

    // Cada worker tem o PRÓPRIO banco (`tests/helpers/worker-db.ts`), então
    // o truncate de um não alcança as tabelas do outro.
    //
    // Antes disto a suíte rodava em `singleFork` justamente porque todos
    // dividiam um banco: oito arquivos em fila, ~310s, com três deles
    // levando ~74s cada. Serializar resolvia a corrida pagando o tempo
    // inteiro — o custo estava na espera do MySQL, não em CPU.
    //
    // `isolate: false` NÃO é otimização: é o que mantém `VITEST_POOL_ID` em
    // 1..N. Com isolamento, cada ARQUIVO ganha um fork novo e um id novo —
    // chegaram a 7 com quatro bancos, e o módulo fez dois workers vivos
    // dividirem o mesmo banco. O deadlock voltou por essa porta.
    //
    // Reusar o fork é seguro aqui porque o estado compartilhado entre
    // arquivos é o banco, e cada worker tem o seu; o `resetDatabase` de cada
    // teste continua sendo a fronteira.
    isolate: false,
    poolOptions: { forks: { maxForks: 4, minForks: 4 } },
    testTimeout: 20_000,
    env: { NODE_ENV: 'test' },
  },
});
