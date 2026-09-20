import { getDb, type Db } from '../shared/infrastructure/prisma/client.js';
import { ulid } from 'ulid';
import { env, isProduction } from '../config/env.js';
import { ScryptPasswordHasher } from '../shared/infrastructure/crypto/scrypt-password-hasher.js';
import { slugify } from '../modules/identity/domain/types.js';
import { seedPricing } from './seed-pricing.js';

/**
 * Seed de desenvolvimento (§49).
 *
 * O seed roda em contexto de sistema, fora de qualquer request, e cria as
 * próprias contas. É uma das superfícies listadas em docs/ARCHITECTURE.md §12 —
 * por isso é explícito e isolado aqui, em vez de espalhar exceções pelo código
 * de aplicação.
 *
 * Idempotente: pode rodar quantas vezes for preciso.
 */
const hasher = new ScryptPasswordHasher();

/**
 * Cliente do seed.
 *
 * Vem de fora porque o BOOT também semeia, e abrir uma segunda conexão a cada
 * start desperdiça pool e mascara erro de configuração de banco.
 *
 * É o cliente COM tenantGuard. Passa porque todo modelo semeado aqui — User,
 * Account, AccountMembership, AiModelPricing — está classificado como UNSCOPED
 * em `tenant-policy.ts`. Se algum dia o seed precisar tocar modelo de tenant,
 * o guard vai barrar, e isso é o comportamento certo: seed não deveria escrever
 * dado de conta sem contexto explícito.
 */
type SeedDb = Db;

export interface SeedOptions {
  /** No boot só interessa o resumo; no CLI, a lista inteira. */
  quiet?: boolean;
}

interface SeedUserSpec {
  name: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'USER';
  accountName: string;
}

async function upsertUserWithAccount(
  prisma: SeedDb,
  spec: SeedUserSpec,
  quiet: boolean,
): Promise<void> {
  const email = spec.email.trim().toLowerCase();
  const passwordHash = await hasher.hash(spec.password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      update: { name: spec.name, role: spec.role, passwordHash, status: 'ACTIVE' },
      create: { id: ulid(), name: spec.name, email, role: spec.role, passwordHash },
    });

    const slug = slugify(spec.accountName);
    const account = await tx.account.upsert({
      where: { slug },
      update: { name: spec.accountName, status: 'ACTIVE' },
      create: { id: ulid(), name: spec.accountName, slug },
    });

    await tx.accountMembership.upsert({
      where: { accountId_userId: { accountId: account.id, userId: user.id } },
      update: { role: 'OWNER' },
      create: { id: ulid(), accountId: account.id, userId: user.id, role: 'OWNER' },
    });

    if (!quiet) {
      console.log(
        `  ✓ ${spec.role.padEnd(5)} ${email}  →  conta "${account.name}" (${account.slug})`,
      );
    }
  });
}

/**
 * Semeia os usuários de desenvolvimento e a tabela de preços.
 *
 * IDEMPOTENTE: tudo é upsert. Pode rodar a cada boot sem consequência — que é
 * exatamente o que o boot faz, porque recriar o container do MySQL apagava o
 * banco e o login parava de funcionar até alguém lembrar de semear à mão.
 *
 * NUNCA em produção: criar um admin com senha padrão conhecida não é
 * conveniência, é porta aberta.
 */
export async function runSeed(prisma: SeedDb, options: SeedOptions = {}): Promise<void> {
  if (isProduction) {
    // env.ts já rejeita as senhas padrão em produção; esta é a segunda barreira.
    throw new Error('O seed de desenvolvimento não deve rodar em produção.');
  }

  const quiet = options.quiet ?? false;
  if (!quiet) console.log('\nSeed MyAIHub — usuários de desenvolvimento\n');

  await upsertUserWithAccount(
    prisma,
    {
      name: 'Administrador MyAIHub',
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      role: 'ADMIN',
      // O admin tem privilégio global, mas também é um usuário comum com a
      // própria conta, seus projetos e seus agentes (§47/§49).
      accountName: 'Conta do Administrador',
    },
    quiet,
  );

  await upsertUserWithAccount(
    prisma,
    {
      name: 'Usuário Teste',
      email: env.SEED_TEST_EMAIL,
      password: env.SEED_TEST_PASSWORD,
      role: 'USER',
      accountName: 'Conta Teste',
    },
    quiet,
  );

  if (!quiet) console.log('\nTabela de preços de IA\n');
  await seedPricing(prisma, { quiet });

  if (!quiet) console.log('\nPronto.\n');
}

/** Entrada do CLI (`npm run db:seed`). O boot chama `runSeed` direto. */
async function cli(): Promise<void> {
  const prisma = getDb();
  try {
    await runSeed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// Só dispara quando ESTE arquivo é o programa. Importar o módulo (que é o que
// o boot faz) não pode executar o seed como efeito colateral do import.
const entrypoint = process.argv[1]?.replaceAll('\\', '/') ?? '';
if (entrypoint.endsWith('/seed.ts') || entrypoint.endsWith('/seed.js')) {
  cli().catch((error: unknown) => {
    console.error('Seed falhou:', error);
    process.exitCode = 1;
  });
}
