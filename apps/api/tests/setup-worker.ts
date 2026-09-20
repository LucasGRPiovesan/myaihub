import { afterAll } from 'vitest';
import { claimSlot, databaseUrlForWorker, releaseSlot } from './helpers/worker-db.js';

/**
 * Aponta este arquivo de teste para o banco DELE, antes de qualquer import de
 * aplicação.
 *
 * Precisa ser um `setupFile`: o `env.ts` lê `process.env` na primeira vez que é
 * importado e congela o resultado. Fazer isso dentro de um helper importado
 * pelo teste chegaria tarde — o container já teria resolvido a URL antiga.
 */
const base = process.env['TEST_DATABASE_URL'];

if (base) {
  const url = databaseUrlForWorker(base, await claimSlot());
  process.env['TEST_DATABASE_URL'] = url;
  // O Prisma lê `DATABASE_URL` direto do ambiente quando o client não passa
  // `datasources`; sem esta linha metade das conexões iria para o banco errado.
  process.env['DATABASE_URL'] = url;
}

// Registrado ANTES dos hooks do arquivo, então roda DEPOIS deles: o banco só é
// devolvido quando o teste já fechou as próprias conexões.
afterAll(releaseSlot);
