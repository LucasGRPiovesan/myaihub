import { env } from './config/env.js';
import { createContainer } from './container.js';
import { createApp } from './http/app.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from './modules/myaihub/infrastructure/master-policy.seed.js';
import { PLAYBOOK_SEEDS } from './modules/myaihub/infrastructure/playbooks.seed.js';
import { disconnectDb } from './shared/infrastructure/prisma/client.js';
import { ensureDatabaseReady } from './shared/infrastructure/prisma/bootstrap.js';
import { SchemaNotAppliedError } from './shared/infrastructure/prisma/schema-check.js';

async function bootstrap(): Promise<void> {
  const container = createContainer();

  // Antes de aceitar requisição: um banco sem schema produz 500 opacos em toda
  // rota, e o sintoma aparece longe da causa.
  // Em dev, aplica migração pendente e semeia; em produção, apenas verifica.
  await ensureDatabaseReady(container.db, container.logger);

  // A Master Policy vive no banco (§27), mas ninguém a semeava fora dos testes:
  // em execução real o OS rodava com `policy = null` — sem taxonomia, sem
  // deduplicação, sem nada. Funcionava, e é justamente isso que torna a falha
  // difícil de ver. O seed é o AUTOR da policy — não há editor — então ele
  // também corrige texto de seção existente, sempre criando versão nova.
  const policy = await container.hub.policies.syncSections(MASTER_POLICY_NAME, MASTER_POLICY_V1);
  if (policy.added.length > 0 || policy.updated.length > 0) {
    container.logger.info(
      {
        versionNumber: policy.version.versionNumber,
        novas: policy.added,
        atualizadas: policy.updated,
      },
      'Master Policy em dia com o seed',
    );
  }

  // Playbooks de ofício, mesma disciplina da policy: cria o que falta, nunca
  // sobrescreve o que o admin já editou. Sem eles o OS projeta agente com o que
  // o modelo por acaso souber do papel — que é raso e muda a cada chamada.
  const seeded = await container.hub.playbooks.seedMissing(PLAYBOOK_SEEDS);
  if (seeded.length > 0) {
    container.logger.info({ playbooks: seeded }, 'playbooks de ofício semeados');
  }

  // A cotação do dólar entra em memória ANTES de o primeiro usuário pedir uma
  // tela. Não é awaited: cotação é informação de exibição, e nenhuma API deve
  // esperar por um site externo para começar a atender.
  void container.usage.exchangeRate.warm();

  // As chaves e o liga/desliga de cada provider entram em memória ANTES da
  // escolha de modelo — ela pergunta `provider.available`, que só existe
  // depois que o registro carregou. Na primeira vez que o banco não tem
  // nenhuma credencial, isto também SEMEIA a partir da `.env` — é o que
  // dispensa qualquer passo manual num banco novo.
  await container.ai.providerRegistry.load();

  // A escolha de modelo do admin entra em memória antes da primeira chamada.
  // Falhar aqui não derruba o boot: sem ela, valem os padrões da env.
  await container.ai.modelRoutes.load();

  // QUAL COTA serviu por último, do banco.
  //
  // Sem isto, todo restart voltava a supor que a cota gratuita está de pé: a
  // Topbar dizia "cota gratuita" com as chamadas saindo pela paga, e o seletor
  // de modelo ficava travado sem haver cota nenhuma para respeitar. A previsão
  // do adapter reinicia com o processo; o histórico, não.
  try {
    const ultima = await container.usage.read.lastServedTierAnywhere();
    if (ultima) container.ai.servedTier.record(ultima.tier);
  } catch (error) {
    container.logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'não foi possível semear a cota servida; o primeiro turno resolve',
    );
  }

  const app = createApp(container);

  const server = app.listen(env.API_PORT, () => {
    container.logger.info(
      { port: env.API_PORT, env: env.NODE_ENV, url: env.API_URL },
      'MyAIHub API no ar',
    );
  });

  const shutdown = (signal: string): void => {
    container.logger.info({ signal }, 'encerrando');
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    // Se conexões abertas segurarem o processo, não ficamos presos para sempre.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Sem estes handlers, uma promise rejeitada fora de um request derruba o
  // processo sem deixar rastro nenhum no log — o pior cenário para diagnosticar.
  process.on('unhandledRejection', (reason) => {
    container.logger.error(
      { err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason },
      'promise rejeitada sem tratamento',
    );
  });

  process.on('uncaughtException', (error) => {
    container.logger.error(
      { err: { message: error.message, stack: error.stack } },
      'exceção não capturada — encerrando',
    );
    // Estado do processo é indeterminado após uma destas: sair é mais seguro
    // que seguir servindo requisições.
    shutdown('uncaughtException');
  });
}

bootstrap().catch((error: unknown) => {
  // O logger depende do container; se a falha for na construção dele, resta stderr.
  if (error instanceof SchemaNotAppliedError) {
    // Erro de setup, não bug: a mensagem já diz o que fazer. Stack trace aqui
    // só afogaria a instrução.
    console.error(`\n${error.message}\n`);
  } else {
    console.error('Falha ao iniciar a API:', error);
  }
  process.exit(1);
});
