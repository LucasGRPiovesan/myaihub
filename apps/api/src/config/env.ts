import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// NUNCA carregar `.env` na Vercel. O tracer de dependências do build (nft)
// inclui o `.env` local no bundle da função mesmo ele sendo ignorado pelo
// git — medido: as DUAS chaves do Gemini do `.env` de desenvolvimento
// apareceram na Vercel de produção como credencial "semeada", sem nenhum
// `GEMINI_API_KEY_PAYED` configurado nas env vars do projeto. `VERCEL` é
// setada pela própria plataforma em toda função; fora dela (dev, teste,
// CI) o arquivo é lido normalmente.
//
// `here` cobre o mesmo arquivo rodando como `tsx src/...` (ESM, tem
// `import.meta.url`) ou `node dist/...` (idem) — `__dirname` só existiria
// num bundle CJS, que este projeto não usa mais para a Vercel.
if (!process.env['VERCEL']) {
  const here = dirname(fileURLToPath(import.meta.url));
  loadDotenv({ path: resolve(here, '../../../../.env'), quiet: true });
}

const booleanFromString = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((value) => value === 'true');

/**
 * Lista separada por vírgula. O default é aplicado ANTES do transform — em Zod 4
 * `.default()` depois de um transform exigiria o tipo de saída (string[]), o que
 * mistura a forma bruta da env com a forma já parseada.
 */
const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );

/** `<provider>:<model>` — ver docs/ARCHITECTURE.md §10. */
const modelRoute = z
  .string()
  .regex(/^[a-z]+:[A-Za-z0-9._-]+$/, 'Formato esperado: <provider>:<model>');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  API_URL: z.url().default('http://localhost:3333'),
  WEB_URL: z.url().default('http://localhost:5173'),
  CORS_ORIGINS: csv('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória.'),
  /**
   * Banco usado quando NODE_ENV=test. Os testes de integração TRUNCAM tabelas —
   * apontar para o banco de desenvolvimento apagaria o trabalho do dia.
   */
  TEST_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres.'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET precisa de ao menos 32 caracteres.'),
  /**
   * 15 min é a duração certa em produção e um estorvo em desenvolvimento: a
   * sessão morre no meio de um teste do Lab e o erro aparece como
   * "Autenticação necessária", longe da causa. O default vira longo fora de
   * produção — quem quiser o comportamento real seta a variável.
   */
  ACCESS_TOKEN_TTL: z.string().default(''),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  COOKIE_SECURE: booleanFromString.default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().default('admin@myaihub.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@123456'),
  SEED_TEST_EMAIL: z.string().default('teste@myaihub.local'),
  SEED_TEST_PASSWORD: z.string().default('Teste@123456'),

  /**
   * Onde os bytes de MediaAsset ficam.
   *
   * Fora de `apps/` de propósito: upload de usuário não é código-fonte e não
   * deve entrar em build, watch nem commit.
   */
  MEDIA_DIR: z.string().default('.media'),

  GEMINI_API_KEY: z.string().optional(),
  /**
   * A chave PAGA do Gemini, usada só quando a cota gratuita do dia acaba.
   *
   * Precisa vir de um projeto com faturamento PRÓPRIO: os limites do Gemini são
   * por projeto, não por chave, então duas chaves do mesmo projeto dividem a
   * mesma cota e não haveria fallback nenhum. Ausente, o sistema roda só com a
   * gratuita, como sempre rodou.
   */
  GEMINI_API_KEY_PAYED: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  MODEL_ROLE_HUB_REASONING: modelRoute.default('gemini:gemini-3.5-flash-lite'),
  MODEL_ROLE_HUB_FAST: modelRoute.default('gemini:gemini-3.5-flash-lite'),
  MODEL_ROLE_AGENT_RUNTIME: modelRoute.default('gemini:gemini-3.5-flash-lite'),
  MODEL_ROLE_VALIDATION_FAST: modelRoute.default('gemini:gemini-3.5-flash-lite'),
  MODEL_ROLE_ANALYSIS_VISION: modelRoute.default('gemini:gemini-3.5-flash-lite'),

  STORAGE_DRIVER: z.enum(['local', 'vercel-blob']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}\n\nVeja .env.example.`);
  }

  const env = parsed.data;

  // Vazio = não foi configurado: produção usa o valor curto, desenvolvimento
  // usa um que sobrevive a uma sessão de trabalho.
  if (!env.ACCESS_TOKEN_TTL) {
    env.ACCESS_TOKEN_TTL = env.NODE_ENV === 'production' ? '15m' : '12h';
  }

  if (env.NODE_ENV === 'test' && env.TEST_DATABASE_URL) {
    env.DATABASE_URL = env.TEST_DATABASE_URL;

    // Efeito colateral deliberado: qualquer PrismaClient construído sem passar
    // `datasources` explicitamente lê process.env.DATABASE_URL direto. Sem esta
    // linha, um client desses apontaria para o banco de DESENVOLVIMENTO enquanto
    // a aplicação usa o de teste — e helpers de teste que truncam tabelas
    // apagariam o banco de trabalho. Isso já aconteceu uma vez; a correção é
    // aqui, num lugar só, e não na disciplina de cada call site.
    process.env['DATABASE_URL'] = env.TEST_DATABASE_URL;
  }

  // Guardrails que não são expressáveis no schema, porque cruzam campos.
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) {
      throw new Error('COOKIE_SECURE precisa ser true em produção.');
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET precisam ser diferentes.');
    }
    // Credenciais de seed são exclusivas de desenvolvimento (§49).
    if (env.SEED_ADMIN_PASSWORD === 'Admin@123456' || env.SEED_TEST_PASSWORD === 'Teste@123456') {
      throw new Error('As senhas de seed padrão não podem ser usadas em produção.');
    }
  }

  return env;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';
