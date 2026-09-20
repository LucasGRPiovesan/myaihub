import { HttpWebContentReader } from '../shared/infrastructure/http/web-content-reader.js';
import { describeVisualIdentity } from '../shared/application/visual-evidence.js';

/**
 * Varredura visual contra um site REAL, sem passar pelo modelo.
 *
 *   npx tsx apps/api/src/scripts/scan-site.local.ts https://www.sankar.com.br/home
 *
 * Existe para separar dois erros que se parecem na tela: "a extração não achou
 * a cor" e "o modelo leu a extração errado". Aqui não há modelo nenhum.
 */
const url = process.argv[2] ?? 'https://www.sankar.com.br/home';

const logger = {
  info: () => undefined,
  warn: (data: unknown, message?: string) => console.error('[aviso]', message, data),
  error: (data: unknown, message?: string) => console.error('[erro]', message, data),
  debug: () => undefined,
  child: () => logger,
} as never;

const reader = new HttpWebContentReader(logger);
const page = await reader.read(url);

if (!page) {
  console.error('Não foi possível ler a página.');
  process.exit(1);
}

console.log('URL   :', page.url);
console.log('Título:', page.title);
console.log('Texto :', page.text.length, 'caracteres');
console.log();

if (!page.visual) {
  console.log('SEM identidade visual extraída.');
  process.exit(1);
}

console.log(describeVisualIdentity(page.visual));
console.log();
console.log('Logos candidatos:', page.visual.logoUrls);
process.exit(0);
