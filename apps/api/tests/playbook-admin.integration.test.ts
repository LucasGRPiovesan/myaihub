import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { agentPlaybookSchema, type AgentPlaybook } from '../src/modules/myaihub/domain/playbook.js';
import { PrismaPlaybookRepository } from '../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import { PLAYBOOK_SEEDS } from '../src/modules/myaihub/infrastructure/playbooks.seed.js';
import {
  elevateScope,
  runWithTenantContext,
  type TenantContext,
} from '../src/shared/application/tenant-context.js';
import { closeTestResources, getTestApp, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTPLAYBOOK00000001';
const OTHER_ACCOUNT_ID = '01ACCOUNTPLAYBOOK00000002';
const USER_ID = '01USERPLAYBOOK0000000001';

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return {
    accountId,
    userId: USER_ID,
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

function playbook(overrides: Partial<AgentPlaybook> = {}): AgentPlaybook {
  return agentPlaybookSchema.parse({
    key: 'test.role',
    label: 'Papel de teste',
    appliesTo: ['algum papel'],
    thesis: 'Uma tese longa o bastante para o schema aceitar sem reclamar de nada.',
    principles: [
      {
        code: 'PR01',
        semanticKey: 'skill.uma_coisa',
        label: 'Faz a coisa',
        facet: 'skills',
        statement: 'Faz uma coisa concreta antes de fazer a outra.',
      },
      {
        code: 'PR02',
        semanticKey: 'behavior.acionavel',
        label: 'Age acionável',
        facet: 'behaviors',
        statement: 'Age de um jeito descrito de forma acionável.',
      },
      {
        code: 'PR03',
        semanticKey: 'communication.curto',
        label: 'Escreve curto',
        facet: 'communication',
        statement: 'Escreve curto e sem preâmbulo de espécie alguma.',
      },
    ],
    ...overrides,
  });
}

describe.skipIf(!enabled)('administração de playbooks', () => {
  const db = rawDb;
  // O repositório usa o client COM tenantGuard — é ele que precisa barrar a
  // leitura cross-tenant. `rawDb` fica só para montar e conferir o cenário.
  const repository = new PrismaPlaybookRepository(getTestApp().container.db);

  beforeEach(async () => {
    await resetDatabase();
    await db.account.createMany({
      data: [
        { id: ACCOUNT_ID, name: 'Conta A', slug: 'conta-a' },
        { id: OTHER_ACCOUNT_ID, name: 'Conta B', slug: 'conta-b' },
      ],
    });
  });

  afterAll(closeTestResources);

  it('salvar cria versão NOVA e mantém a anterior', async () => {
    // Curadoria de ofício é opinião, e opinião erra. Sobrescrever tiraria a
    // única saída possível: voltar para a versão anterior.
    await repository.seedMissing([playbook()]);

    const second = await repository.saveVersion(
      'test.role',
      playbook({ label: 'Nome revisado' }),
      'Ajustei o nome.',
    );

    expect(second).toBe(2);
    expect((await repository.findByKey('test.role'))?.label).toBe('Nome revisado');

    const history = await repository.history('test.role');
    expect(history.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(history[0]?.reason).toBe('Ajustei o nome.');
  });

  it('a semente NÃO sobrescreve o que o admin editou', async () => {
    await repository.seedMissing([playbook()]);
    await repository.saveVersion('test.role', playbook({ label: 'Curado à mão' }), 'Curadoria.');

    const written = await repository.seedMissing([playbook({ label: 'Da semente' })]);

    expect(written).toEqual([]);
    expect((await repository.findByKey('test.role'))?.label).toBe('Curado à mão');
  });

  it('versão gravada que não bate mais com o schema é RESSEMEADA', async () => {
    // Sem isto, uma mudança de formato desativaria o playbook em silêncio: o
    // leitor o descarta e o OS volta a projetar sem ofício, sem nada acusar.
    await repository.seedMissing([playbook()]);
    await db.playbookVersion.updateMany({
      where: { versionNumber: 1 },
      data: { content: { key: 'test.role', formatoAntigo: true } },
    });

    expect(await repository.findByKey('test.role')).toBeNull();

    const written = await repository.seedMissing([playbook()]);

    expect(written).toEqual(['test.role']);
    expect((await repository.findByKey('test.role'))?.principles).toHaveLength(3);
    // A versão ruim continua no histórico: ressemear não apaga o passado.
    expect(await repository.history('test.role')).toHaveLength(2);
  });

  it('a pauta agrega por papel e EXIGE escopo elevado', async () => {
    await runWithTenantContext(tenant(), async () => {
      await repository.recordMiss(tenant(), 'Recepcionista de clínica');
      await repository.recordMiss(tenant(), 'Recepcionista de clínica');
    });
    await runWithTenantContext(tenant(OTHER_ACCOUNT_ID), () =>
      repository.recordMiss(tenant(OTHER_ACCOUNT_ID), 'Nutricionista'),
    );

    // Sem elevação o tenantGuard barra: a leitura é cross-tenant de verdade.
    await expect(runWithTenantContext(tenant(), () => repository.listMisses(10))).rejects.toThrow(
      /tenant/i,
    );

    const admin = { ...tenant(), role: 'ADMIN' as const };
    const misses = await runWithTenantContext(
      elevateScope(admin, ACCOUNT_ID, 'pauta da plataforma'),
      () => repository.listMisses(10),
    );

    // Duas contas diferentes, um só painel: é o que faz dela a pauta da
    // plataforma, e não um relatório por cliente.
    expect(misses.map((miss) => `${miss.role}:${miss.count}`)).toEqual([
      'Recepcionista de clínica:2',
      'Nutricionista:1',
    ]);
  });

  it('a listagem do admin ignora playbook ilegível em vez de exibi-lo como ativo', async () => {
    await repository.seedMissing([playbook()]);
    await db.playbookVersion.updateMany({ data: { content: { quebrado: true } } });

    expect(await repository.listForAdmin()).toEqual([]);
  });

  it('as sementes do produto sobrevivem a uma ida e volta pelo banco', async () => {
    // O que é escrito no arquivo precisa ser lido de volta idêntico; um campo
    // que não sobrevive à serialização sumiria sem ninguém notar.
    await repository.seedMissing(PLAYBOOK_SEEDS);

    for (const seed of PLAYBOOK_SEEDS) {
      expect(await repository.findByKey(seed.key), seed.key).toEqual(seed);
    }
  });
});
