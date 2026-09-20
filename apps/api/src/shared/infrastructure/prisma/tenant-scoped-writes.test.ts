import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TENANT_MODEL_POLICY } from './tenant-policy.js';

/**
 * Escrita em modelo tenant-scoped precisa carregar `accountId` no `where`.
 *
 * Este teste existe porque a suíte de integração NÃO alcança esta classe de
 * bug: ela usa o client CRU, sem o tenantGuard, justamente para poder montar e
 * inspecionar estado cross-tenant. O resultado é que um
 * `update({ where: { id } })` num modelo de conta passa verde ali e explode em
 * produção — foi assim com a identidade de marca, o conhecimento e a sessão de
 * conversa, todos encontrados só no navegador, um por vez.
 *
 * Um `where` sem `accountId` é a forma exata do IDOR. O guard barra em runtime;
 * este teste barra antes, na hora de escrever o código.
 *
 * A regra é simples e a saída também: use `updateMany`/`deleteMany` com
 * `accountId` no `where` — que é o que o resto do projeto já faz.
 */

// Derivado deste arquivo, não do CWD: o Vitest roda da raiz do monorepo, e
// `process.cwd()` apontaria para um `src/modules` que não existe.
const MODULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'modules');

const TENANT_SCOPED = new Set(
  Object.entries(TENANT_MODEL_POLICY)
    .filter(([, policy]) => policy.scope === 'TENANT_SCOPED')
    .map(([model]) => model.charAt(0).toLowerCase() + model.slice(1)),
);

function arquivosTypeScript(dir: string): string[] {
  const encontrados: string[] = [];

  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...arquivosTypeScript(caminho));
      continue;
    }
    if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts')) encontrados.push(caminho);
  }

  return encontrados;
}

describe('escrita em modelo tenant-scoped', () => {
  it('nunca usa `update`/`delete` singular — só as formas com `accountId`', () => {
    const infracoes: string[] = [];

    for (const arquivo of arquivosTypeScript(MODULES_DIR)) {
      const conteudo = readFileSync(arquivo, 'utf8');

      for (const modelo of TENANT_SCOPED) {
        // `update(` e `delete(` singulares aceitam só chave única no `where`, e
        // por isso não comportam o `accountId`. As formas `updateMany` e
        // `deleteMany` comportam — e são as que o guard aceita.
        const padrao = new RegExp(`\\.${modelo}\\.(update|delete)\\(`, 'g');
        for (const achado of conteudo.matchAll(padrao)) {
          infracoes.push(
            `${arquivo.slice(MODULES_DIR.length + 1)}: ${modelo}.${achado[1]}() — ` +
              `use ${modelo}.${achado[1]}Many({ where: { id, accountId } }).`,
          );
        }
      }
    }

    expect(infracoes, infracoes.join('\n')).toEqual([]);
  });

  it('a lista de modelos escaneados não está vazia', () => {
    // Uma regressão no `tenant-policy.ts` (ou no caminho dos módulos) faria o
    // teste acima passar sem verificar nada — o pior tipo de verde.
    expect(TENANT_SCOPED.size).toBeGreaterThan(10);
    expect(arquivosTypeScript(MODULES_DIR).length).toBeGreaterThan(20);
  });
});
