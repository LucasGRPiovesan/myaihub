-- Seed de demo/teste — pedido explícito do dono do produto para o ambiente
-- em teste na Vercel (o app ainda não está em uso real): expõe login por
-- seleção de usuário em vez de formulário. Diferente do seed de
-- desenvolvimento (`apps/api/src/scripts/seed.ts`), que se recusa a rodar em
-- produção, esta migração é dado explícito, versionado e revisado — o mesmo
-- caminho por onde qualquer outra migração altera o banco de produção.
--
-- Hash gerado com o MESMO `ScryptPasswordHasher` da aplicação
-- (scrypt$N$r$p$salt$hash, N=32768 r=8 p=1). Senhas em texto puro nunca
-- entram no banco nem neste arquivo.
--   admin@myaihub.local  / Admin@123456
--   teste@myaihub.local  / Teste@123456
--
-- Email/slug já podem existir (dev roda `runSeed` no boot com os mesmos
-- endereços-padrão) — por isso o vínculo em `account_memberships` busca o id
-- REAL por email/slug em vez de reusar o ULID gerado aqui: um `ON DUPLICATE
-- KEY UPDATE` nas duas tabelas anteriores pode manter o id da linha já
-- existente, e gravar o ULID literal quebraria a foreign key.

INSERT INTO `users` (`id`, `name`, `email`, `passwordHash`, `role`, `status`, `createdAt`, `updatedAt`)
VALUES
  ('01M2ZMEK9R76XJ8KW2FVQBVYFZ', 'Administrador MyAIHub', 'admin@myaihub.local',
   'scrypt$32768$8$1$0mOze_p1Fz6ZGZacdpBs0g$URxAm3xkVXqEPzK9wW0dEvXBVFikR0nMq94pn8t9OnpqNpyZ0-uajCw5G8YBKZK64yIJg5ymqaQ0OAtoRrR5Cg',
   'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('01M2ZMEK9SFBN67S9BFTT9H7KH', 'Usuário Teste', 'teste@myaihub.local',
   'scrypt$32768$8$1$0Vh9hWDxm9QmXuf4IUgwTA$2TKcJxgasYGrfsCOtDFjkuceCWeNRjXFC50RpjJeMv_3v7rKIjMWbKTz7CtMQJSY2TDp9N_LxEQvw8r6866sBg',
   'USER', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `passwordHash` = VALUES(`passwordHash`), `role` = VALUES(`role`);

INSERT INTO `accounts` (`id`, `name`, `slug`, `status`, `createdAt`, `updatedAt`)
VALUES
  ('01M2ZMEK9S05PGPY4HNSNWXG89', 'Conta do Administrador', 'conta-do-administrador', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('01M2ZMEK9SVDEJD2TQSXV0ZYN3', 'Conta Teste', 'conta-teste', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `account_memberships` (`id`, `accountId`, `userId`, `role`, `createdAt`)
SELECT '01M2ZMEK9SHGGP9R4E5G69MK2E', a.id, u.id, 'OWNER', CURRENT_TIMESTAMP(3)
FROM `accounts` a, `users` u
WHERE a.slug = 'conta-do-administrador' AND u.email = 'admin@myaihub.local'
ON DUPLICATE KEY UPDATE `role` = VALUES(`role`);

INSERT INTO `account_memberships` (`id`, `accountId`, `userId`, `role`, `createdAt`)
SELECT '01M2ZMEK9SG95XA3J6F9CT7D0Z', a.id, u.id, 'OWNER', CURRENT_TIMESTAMP(3)
FROM `accounts` a, `users` u
WHERE a.slug = 'conta-teste' AND u.email = 'teste@myaihub.local'
ON DUPLICATE KEY UPDATE `role` = VALUES(`role`);
