import {
  emptyAgent,
  emptyProjectProfile,
  summarizeAgent,
  summarizeProjectProfile,
} from '@myaihub/shared';
import { ulid } from 'ulid';
import { runWithTenantContext, systemTenantContext } from '../shared/application/tenant-context.js';
import { getDb } from '../shared/infrastructure/prisma/client.js';

/**
 * Fixture do E2E: um projeto pronto para as telas de marca e conhecimento.
 *
 * Por que uma fixture e não criar pelo OS dentro do teste: a criação de projeto
 * passa por saída estruturada do modelo, e no E2E o provider é o FAKE — pedir a
 * ele um documento canônico completo transformaria um teste sobre TELAS num
 * teste sobre o dublê. A criação já é coberta pela suíte de integração, contra
 * o runner de verdade.
 *
 * Idempotente: o E2E roda muitas vezes na mesma máquina, e um projeto novo por
 * execução faria a lista crescer até o teste passar a encontrar o errado.
 */
async function main(): Promise<void> {
  const db = getDb();

  const conta = await db.account.findFirst({
    where: { slug: 'conta-do-administrador' },
    select: { id: true },
  });

  if (!conta) {
    console.error('Conta do E2E não encontrada. Rode o seed de usuários antes.');
    process.exit(1);
  }

  const usuario = await db.user.findFirst({
    where: { email: 'e2e@myaihub.local' },
    select: { id: true },
  });

  if (!usuario) {
    console.error('Usuário do E2E não encontrado.');
    process.exit(1);
  }

  // Escrita de modelo TENANT-SCOPED fora de request: precisa de contexto
  // explícito, e o guard do Prisma barraria sem ele — que é o comportamento
  // certo. Um script não escreve dado de conta em silêncio.
  await runWithTenantContext(systemTenantContext('Seed do E2E: projeto de fixture.'), async () => {
    const existente = await db.project.findFirst({
      where: { accountId: conta.id, slug: 'projeto-e2e' },
      select: { id: true },
    });

    if (existente) {
      console.log(`Projeto de fixture já existe: ${existente.id}`);
      return;
    }

    const projectId = ulid();
    const versionId = ulid();
    const canonical = {
      ...emptyProjectProfile('Projeto E2E'),
      summary: 'Indústria de peças metálicas sob medida, usada pelos testes de navegador.',
    };

    await db.$transaction(async (tx) => {
      await tx.project.create({
        data: {
          id: projectId,
          accountId: conta.id,
          name: 'Projeto E2E',
          slug: 'projeto-e2e',
          createdBy: usuario.id,
          currentProfileVersionId: versionId,
        },
      });

      await tx.projectProfileVersion.create({
        data: {
          id: versionId,
          accountId: conta.id,
          projectId,
          versionNumber: 1,
          canonicalConfig: canonical,
          canonicalSchemaVersion: canonical.canonicalSchemaVersion,
          humanSummary: summarizeProjectProfile(canonical),
          source: 'SYSTEM',
          reason: 'Fixture do E2E.',
          createdBy: usuario.id,
        },
      });

      await tx.projectCapability.create({
        data: {
          id: ulid(),
          accountId: conta.id,
          projectId,
          type: 'CAMPAIGNS',
        },
      });
    });

    console.log(`Projeto de fixture criado: ${projectId}`);

    // O AGENTE da fixture, e a campanha que o liga ao projeto.
    //
    // Sem eles o Lab pelo projeto não tem com quem conversar — e é lá que roda
    // o teste que prova que a conversa sobrevive a um recarregamento, que é a
    // promessa central da Fase 8.
    //
    // Configuração mínima escrita à mão: criar pelo OS passaria por saída
    // estruturada do modelo, e no E2E o provider é o FAKE.
    const agentId = ulid();
    const agentVersionId = ulid();
    const agente = {
      ...emptyAgent('Alex E2E'),
      identity: { name: 'Alex E2E', role: 'Atendente de testes' },
      objective: {
        primary: 'Responder quem chega, sem prometer o que não sabe.',
        secondary: [],
      },
    };

    await db.$transaction(async (tx) => {
      await tx.agent.create({
        data: {
          id: agentId,
          accountId: conta.id,
          name: 'Alex E2E',
          slug: 'alex-e2e',
          role: 'Atendente de testes',
          createdBy: usuario.id,
          currentVersionId: agentVersionId,
        },
      });

      await tx.agentVersion.create({
        data: {
          id: agentVersionId,
          accountId: conta.id,
          agentId,
          versionNumber: 1,
          canonicalConfig: agente,
          canonicalSchemaVersion: agente.canonicalSchemaVersion,
          humanSummary: summarizeAgent(agente),
          source: 'SYSTEM',
          reason: 'Fixture do E2E.',
          createdBy: usuario.id,
        },
      });

      await tx.campaign.create({
        data: {
          id: ulid(),
          accountId: conta.id,
          projectId,
          agentId,
          name: 'Campanha E2E',
          slug: 'campanha-e2e',
          createdBy: usuario.id,
        },
      });
    });

    console.log(`Agente de fixture criado: ${agentId}`);
  });

  process.exit(0);
}

void main();
