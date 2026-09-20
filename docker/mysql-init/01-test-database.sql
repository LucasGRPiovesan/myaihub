-- Banco dedicado aos testes de integração.
--
-- Os testes truncam tabelas a cada arquivo; se apontassem para o banco de
-- desenvolvimento, apagariam o trabalho em andamento.
CREATE DATABASE IF NOT EXISTS myaihub_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Shadow database do Prisma Migrate.
--
-- `prisma migrate dev` cria e destrói um banco descartável para detectar drift
-- do schema. O usuário da aplicação não tem (nem deve ter) CREATE DATABASE, então
-- o banco é provisionado aqui e apontado por SHADOW_DATABASE_URL.
CREATE DATABASE IF NOT EXISTS myaihub_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON myaihub_test.* TO 'myaihub'@'%';
GRANT ALL PRIVILEGES ON myaihub_shadow.* TO 'myaihub'@'%';
FLUSH PRIVILEGES;

-- Um banco por worker de teste (ver apps/api/tests/helpers/worker-db.ts).
--
-- A suíte roda em paralelo e cada worker trunca o PRÓPRIO banco. Compartilhar
-- um só obrigava a serializar tudo num processo: oito arquivos em fila, ~310s.
--
-- Provisionados aqui, e não pelo Prisma: criar banco exige acesso ao schema
-- `mysql`, e o usuário da aplicação não tem CREATE DATABASE de propósito.
CREATE DATABASE IF NOT EXISTS myaihub_test_1 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS myaihub_test_2 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS myaihub_test_3 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS myaihub_test_4 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON `myaihub\_test\_%`.* TO 'myaihub'@'%';
FLUSH PRIVILEGES;

-- Banco do E2E (Playwright, Fase 11).
--
-- Separado do de integração de propósito: o E2E SEMEIA um admin e conversa com
-- a aplicação inteira no ar, enquanto os testes de integração truncam tudo a
-- cada caso. Compartilhar um banco faria um apagar o estado do outro no meio.
CREATE DATABASE IF NOT EXISTS myaihub_e2e
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON myaihub_e2e.* TO 'myaihub'@'%';
FLUSH PRIVILEGES;
