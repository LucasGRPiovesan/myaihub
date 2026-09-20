import { defaultBrandIdentity } from '@myaihub/shared';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ManageKnowledgeUseCase } from '../src/modules/projects/application/manage-knowledge.use-case.js';
import { PrismaBrandIdentityRepository } from '../src/modules/projects/infrastructure/prisma-brand-identity.repository.js';
import { PrismaKnowledgeRepository } from '../src/modules/projects/infrastructure/prisma-knowledge.repository.js';
import { PrismaAuditWriter } from '../src/shared/infrastructure/audit/prisma-audit-writer.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import { UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import { FakeWebContentReader } from './helpers/runner.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTASSET0000000001';
const OTHER_ACCOUNT = '01ACCOUNTASSET0000000002';
const USER_ID = '01USERASSET000000000001';

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return {
    accountId,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/**
 * Marca e conhecimento (Fase 5), contra banco real.
 *
 * O que se prova aqui é o que só existe em transação: a versão da marca e o
 * ponteiro do projeto saem juntos, e uma revisão de conhecimento com o MESMO
 * conteúdo não pode criar linha nova — senão todo snapshot passaria a apontar
 * para um id que descreve exatamente o mesmo texto.
 */
describe.skipIf(!enabled)('marca e conhecimento do projeto', () => {
  const ids = new UlidGenerator();
  const audit = new PrismaAuditWriter(rawDb as never, ids);
  const brands = new PrismaBrandIdentityRepository(rawDb as never, audit);
  const knowledgeRepo = new PrismaKnowledgeRepository(rawDb as never);
  const web = new FakeWebContentReader();
  const knowledge = new ManageKnowledgeUseCase({
    knowledge: knowledgeRepo,
    reader: web,
    ids,
    audit,
  });

  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    web.pages.clear();

    for (const accountId of [ACCOUNT_ID, OTHER_ACCOUNT]) {
      await rawDb.account.create({
        data: { id: accountId, name: 'Conta', slug: `conta-${accountId}` },
      });
    }

    projectId = ids.generate();
    await rawDb.project.create({
      data: {
        id: projectId,
        accountId: ACCOUNT_ID,
        name: 'Sankar',
        slug: 'sankar',
        createdBy: USER_ID,
      },
    });
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function salvarMarca(reason = 'Primeira identidade') {
    const projeto = await rawDb.project.findUniqueOrThrow({ where: { id: projectId } });

    return brands.update(tenant(), {
      projectId,
      expectedLockVersion: projeto.lockVersion,
      version: {
        id: ids.generate(),
        canonicalConfig: {
          ...defaultBrandIdentity('Sankar'),
          tagline: 'Peças sob medida',
          colors: { ...defaultBrandIdentity('Sankar').colors, primary: '#0f172a' },
        },
        humanSummary: ['Cor principal: #0f172a'],
        source: 'USER',
        reason,
      },
      change: {
        id: ids.generate(),
        entityType: 'PROJECT_BRAND_IDENTITY',
        fromVersionId: null,
        fromVersion: null,
        source: 'USER',
        actorUserId: USER_ID,
        hubOperationId: null,
        hubMessageId: null,
        interpretedIntent: reason,
        mutations: [],
        rationale: 'Teste.',
      },
      audit: {
        accountId: ACCOUNT_ID,
        actorUserId: USER_ID,
        action: 'project.brand_identity_updated',
        entityType: 'Project',
        entityId: projectId,
      },
    });
  }

  it('versão, ponteiro, change e auditoria saem na MESMA transação', async () => {
    const versao = await salvarMarca();

    const projeto = await rawDb.project.findUniqueOrThrow({ where: { id: projectId } });
    const change = await rawDb.configurationChange.findFirst({
      where: { entityId: projectId, entityType: 'PROJECT_BRAND_IDENTITY' },
    });
    const auditoria = await rawDb.auditLog.findFirst({
      where: { action: 'project.brand_identity_updated' },
    });

    expect(projeto.currentBrandIdentityVersionId).toBe(versao.id);
    expect(change).not.toBeNull();
    expect(auditoria).not.toBeNull();
  });

  it('salvar de novo com o lock velho é REJEITADO', async () => {
    await salvarMarca();

    await expect(
      brands.update(tenant(), {
        projectId,
        // O projeto já foi para lockVersion 1; quem leu antes tem 0 na mão.
        expectedLockVersion: 0,
        version: {
          id: ids.generate(),
          canonicalConfig: defaultBrandIdentity('Sankar'),
          humanSummary: [],
          source: 'USER',
          reason: 'Concorrente',
        },
        change: {
          id: ids.generate(),
          entityType: 'PROJECT_BRAND_IDENTITY',
          fromVersionId: null,
          fromVersion: null,
          source: 'USER',
          actorUserId: USER_ID,
          hubOperationId: null,
          hubMessageId: null,
          interpretedIntent: 'Concorrente',
          mutations: [],
          rationale: 'Teste.',
        },
        audit: {
          accountId: ACCOUNT_ID,
          actorUserId: USER_ID,
          action: 'project.brand_identity_updated',
          entityType: 'Project',
          entityId: projectId,
        },
      }),
    ).rejects.toThrow();
  });

  it('a marca de outra conta não é alcançável', async () => {
    await salvarMarca();

    expect(await brands.findCurrent(tenant(OTHER_ACCOUNT), projectId)).toBeNull();
  });

  it('fonte de texto vira revisão pronta na hora', async () => {
    const fonte = await knowledge.create(tenant(), projectId, {
      kind: 'TEXT',
      title: 'Política de troca',
      content: 'Aceitamos troca em até 30 dias.',
    });

    expect(fonte.status).toBe('READY');
    expect(fonte.revisionNumber).toBe(1);
    expect(fonte.contentLength).toBeGreaterThan(0);
  });

  it('reindexar com o MESMO conteúdo não cria revisão', async () => {
    web.pages.set('https://exemplo.com/trocas', {
      url: 'https://exemplo.com/trocas',
      title: 'Trocas',
      text: 'Aceitamos troca em até 30 dias.',
      truncated: false,
    });

    const fonte = await knowledge.create(tenant(), projectId, {
      kind: 'URL',
      title: 'Trocas',
      uri: 'https://exemplo.com/trocas',
    });

    const depois = await knowledge.reindex(tenant(), fonte.id);

    // Revisão nova aqui geraria um id descrevendo exatamente o mesmo texto, e o
    // histórico deixaria de dizer quando o conhecimento de fato mudou.
    expect(depois.revisionNumber).toBe(1);
    expect(await rawDb.knowledgeRevision.count({ where: { sourceId: fonte.id } })).toBe(1);
  });

  it('conteúdo diferente cria revisão nova e move o ponteiro', async () => {
    web.pages.set('https://exemplo.com/trocas', {
      url: 'https://exemplo.com/trocas',
      title: 'Trocas',
      text: 'Aceitamos troca em até 30 dias.',
      truncated: false,
    });

    const fonte = await knowledge.create(tenant(), projectId, {
      kind: 'URL',
      title: 'Trocas',
      uri: 'https://exemplo.com/trocas',
    });

    web.pages.set('https://exemplo.com/trocas', {
      url: 'https://exemplo.com/trocas',
      title: 'Trocas',
      text: 'Agora são 15 dias.',
      truncated: false,
    });

    const depois = await knowledge.reindex(tenant(), fonte.id);

    expect(depois.revisionNumber).toBe(2);
  });

  it('URL inalcançável vira FALHA com motivo, não exceção', async () => {
    const fonte = await knowledge.create(tenant(), projectId, {
      kind: 'URL',
      title: 'Site fora do ar',
      uri: 'https://exemplo.com/inexistente',
    });

    // A fonte EXISTE e o usuário pode reindexar. Lançar aqui perderia o
    // cadastro dele por causa de uma indisponibilidade temporária.
    expect(fonte.status).toBe('FAILED');
    expect(fonte.lastError).toBeTruthy();
  });

  it('o snapshot congela a revisão CORRENTE de cada fonte pronta', async () => {
    await knowledge.create(tenant(), projectId, {
      kind: 'TEXT',
      title: 'Trocas',
      content: 'Aceitamos troca em até 30 dias.',
    });
    await knowledge.create(tenant(), projectId, {
      kind: 'TEXT',
      title: 'Prazos',
      content: 'Protótipo em cinco dias úteis.',
    });

    const snapshotId = await knowledge.snapshot(tenant(), projectId);
    expect(snapshotId).not.toBeNull();

    const conteudo = await knowledgeRepo.readSnapshot(tenant(), snapshotId as string);
    expect(conteudo).toHaveLength(2);
    expect(conteudo.map((entrada) => entrada.title).sort()).toEqual(['Prazos', 'Trocas']);
  });

  it('o snapshot NÃO muda quando a fonte é reindexada depois', async () => {
    const fonte = await knowledge.create(tenant(), projectId, {
      kind: 'TEXT',
      title: 'Trocas',
      content: 'Aceitamos troca em até 30 dias.',
    });

    const snapshotId = (await knowledge.snapshot(tenant(), projectId)) as string;

    await knowledge.replaceText(tenant(), fonte.id, 'Agora são 15 dias.');

    const congelado = await knowledgeRepo.readSnapshot(tenant(), snapshotId);

    // É isto que faz a publicação continuar reproduzível quando o conteúdo do
    // cliente muda no dia seguinte.
    expect(congelado[0]?.extractedContent).toContain('30 dias');
  });

  it('projeto sem fonte nenhuma não produz snapshot vazio', async () => {
    // Um id que não descreve nada faria o manifest afirmar ter congelado
    // conhecimento que não existe.
    expect(await knowledge.snapshot(tenant(), projectId)).toBeNull();
  });

  it('fonte de outra conta não é alcançável', async () => {
    const fonte = await knowledge.create(tenant(), projectId, {
      kind: 'TEXT',
      title: 'Trocas',
      content: 'Aceitamos troca em até 30 dias.',
    });

    expect(await knowledgeRepo.findSource(tenant(OTHER_ACCOUNT), fonte.id)).toBeNull();
    expect(await knowledge.list(tenant(OTHER_ACCOUNT), projectId)).toEqual([]);
  });
});
