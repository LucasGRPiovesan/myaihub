import { Prisma, PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { env } from '../../src/config/env.js';
import { createContainer, type Container } from '../../src/container.js';
import { createApp } from '../../src/http/app.js';

if (!env.TEST_DATABASE_URL || env.DATABASE_URL !== env.TEST_DATABASE_URL) {
  // Este arquivo TRUNCA tabelas. Se a URL resolvida não for a de teste, algo na
  // configuração mudou e a próxima linha apagaria o banco errado.
  throw new Error(
    'Helper de teste apontando para um banco que não é o de teste. Abortado antes de truncar.',
  );
}

/**
 * Client CRU, sem o tenantGuard.
 *
 * Os testes precisam montar e inspecionar estado cross-tenant para PROVAR que o
 * isolamento funciona — usar o client guardado aqui seria circular. É uma das
 * superfícies listadas em docs/ARCHITECTURE.md §12, por isso fica confinada a
 * este helper e não vaza para o código de aplicação.
 */
export const rawDb = new PrismaClient({
  // Explícito, mesmo com env.ts já normalizando process.env: quem trunca tabelas
  // não deve depender de um efeito colateral remoto para saber onde está.
  datasources: { db: { url: env.DATABASE_URL } },
});

let cached: { container: Container; app: Express } | null = null;

export function getTestApp(): { container: Container; app: Express } {
  if (!cached) {
    const container = createContainer();
    cached = { container, app: createApp(container) };
  }
  return cached;
}

/**
 * Ordem de exclusão derivada do grafo de relações do schema.
 *
 * Quem tem chave estrangeira é apagado ANTES de quem ele referencia. Derivar do
 * DMMF em vez de manter uma lista à mão importa: lista manual para de limpar
 * todo modelo novo em silêncio, e o estado vazado entre testes vira falha
 * intermitente atribuída ao código errado. Já aconteceu neste projeto.
 */
function deletionOrder(): string[] {
  const models = Prisma.dmmf.datamodel.models;

  const references = new Map<string, string[]>(
    models.map((model) => [
      model.name,
      model.fields
        .filter((field) => field.kind === 'object' && (field.relationFromFields?.length ?? 0) > 0)
        .map((field) => field.type)
        .filter((target) => target !== model.name),
    ]),
  );

  const visited = new Set<string>();
  const postOrder: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const target of references.get(name) ?? []) visit(target);
    postOrder.push(name);
  };

  for (const model of models) visit(model.name);

  // Pós-ordem coloca o referenciado antes; invertendo, quem referencia vem primeiro.
  return postOrder.reverse();
}

const DELETION_ORDER = deletionOrder();

/** Delegates na ordem de deleção, resolvidos uma vez só. */
const DELETION_DELEGATES = DELETION_ORDER.map((model) => {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (rawDb as unknown as Record<string, { deleteMany(): unknown } | undefined>)[key];
}).filter((delegate): delegate is { deleteMany(): unknown } => Boolean(delegate));

/**
 * Zera o banco entre testes.
 *
 * UM lote, não trinta idas ao banco. A versão anterior fazia `await` por modelo
 * num laço sequencial: com ~28 tabelas e ~56 testes de integração, eram ~1.600
 * viagens de ida e volta gastas só limpando — e o MySQL está em Docker num
 * disco mecânico, onde cada viagem custa.
 *
 * A forma em array do `$transaction` preserva a ordem (que importa por causa
 * das chaves estrangeiras) e manda tudo numa transação só.
 */
export async function resetDatabase(): Promise<void> {
  await rawDb.$transaction(DELETION_DELEGATES.map((delegate) => delegate.deleteMany()) as never);
}

export async function closeTestResources(): Promise<void> {
  await rawDb.$disconnect();
}

export async function promoteToAdmin(email: string): Promise<void> {
  await rawDb.user.update({ where: { email }, data: { role: 'ADMIN' } });
}
