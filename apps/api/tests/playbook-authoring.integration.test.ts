import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import { type MyAIHubOperationRunner } from '../src/modules/myaihub/application/operation-runner.js';
import { CREATE_PLAYBOOK } from '../src/modules/myaihub/domain/playbook-operations.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from '../src/modules/myaihub/infrastructure/master-policy.seed.js';
import type {
  PrismaHubConversationRepository,
  PrismaPlaybookRepository,
} from '../src/modules/myaihub/infrastructure/prisma-hub.repositories.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import { createTestRunner } from './helpers/runner.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTPBK0000000000001';
const USER_ID = '01USERPBK00000000000000001'.slice(0, 26);

/** ADMIN: escrever ofício é ato de plataforma, e a leitura da pauta é elevada. */
function tenant(): TenantContext {
  return {
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    role: 'ADMIN',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/**
 * O OS escreve o ofício que ele mesmo detectou faltar.
 *
 * Até aqui ele registrava a lacuna e esperava um humano: papel sem playbook
 * virava `PlaybookMiss`, o agente nascia genérico, e alguém teria de escrever o
 * ofício à mão algum dia. Registrar o próprio limite e parar é o oposto do que
 * este produto promete — quem administra intenção é o usuário; a implementação
 * é do OS.
 *
 * O FakeProvider aqui representa a saída CERTA. O que este arquivo prova não é
 * que o modelo escreve bem, e sim que o CAMINHO existe: identidade de topo vira
 * mutação, a chave chega ao agregado, o ofício nasce versionado e auditado — e
 * que ele NÃO nasce quando a chave falta.
 */
const OUTPUT = JSON.stringify({
  identity: {
    key: 'reception.clinic',
    label: 'Recepção de clínica',
    thesis:
      'Quem recebe alguém que chegou por um anúncio precisa acolher, entender o motivo da ' +
      'procura e agendar — sem prometer diagnóstico, preço fechado nem horário que não existe.',
    appliesTo: ['recepcionista de clínica', 'atendente de consultório odontológico'],
  },
  intent: 'CHANGE',
  plan: ['Lendo a pauta', 'Escrevendo o ofício', 'Salvando a primeira versão'],
  interpretedIntent: 'Escrever o ofício de recepção de clínica',
  rationale: 'O papel apareceu na pauta e não havia playbook que o cobrisse.',
  humanSummary: 'Escrevi o ofício de recepção de clínica, com 6 princípios e 3 limites.',
  mutations: [
    {
      kind: 'UPSERT_PRINCIPLE',
      semanticKey: 'behavior.motivo_antes_da_agenda',
      facet: 'behaviors',
      label: 'Motivo antes da agenda',
      statement:
        'Pergunte o motivo da procura antes de oferecer horário: a agenda certa depende do ' +
        'tipo de atendimento, e oferecer antes obriga a desmarcar depois.',
      enforcement: 'SOFT',
    },
    {
      kind: 'UPSERT_PRINCIPLE',
      semanticKey: 'limit.sem_diagnostico',
      // As facetas do playbook vão de personality a hardRules — nao existe
      // faceta "limits" aqui. Proibicao vira principio HARD em hardRules, ou
      // entra como limite por UPSERT_LIMIT.
      facet: 'hardRules',
      label: 'Nunca diagnostica',
      statement:
        'Nunca diga o que a pessoa tem nem o que ela precisa fazer clinicamente. Quando ela ' +
        'perguntar, diga que quem avalia é o profissional e ofereça a avaliação.',
      enforcement: 'HARD',
    },
    {
      kind: 'UPSERT_PRINCIPLE',
      semanticKey: 'communication.acolhimento',
      facet: 'communication',
      label: 'Acolhe antes de resolver',
      statement:
        'Responda primeiro à preocupação da pessoa, depois ao procedimento: quem chega com ' +
        'dor não quer saber de convênio antes de ser ouvido.',
      enforcement: 'SOFT',
    },
    {
      kind: 'UPSERT_LIMIT',
      semanticKey: 'limit.preco_fechado',
      label: 'Não fecha preço',
      statement:
        'Não confirme valor de tratamento: ele depende da avaliação. Diga isso e ofereça a ' +
        'consulta de avaliação.',
    },
    {
      kind: 'UPSERT_QUESTION',
      semanticKey: 'question.horarios',
      question: 'Quais são os horários e dias de atendimento da clínica?',
      why: 'Sem isso o agente oferece horário que não existe.',
      placeholder: 'Seg a sex, 8h às 18h',
    },
  ],
  conflicts: [],
  gaps: [],
});

describe.skipIf(!enabled)('o OS escreve o ofício que falta', () => {
  let runner: MyAIHubOperationRunner;
  let conversations: PrismaHubConversationRepository;
  let playbooks: PrismaPlaybookRepository;
  const provider = new FakeProvider();
  /** Conversa nova a cada chamada: o id é único e dois turnos colidiriam. */
  let sequencia = 0;

  beforeEach(async () => {
    await resetDatabase();
    provider.reset();
    sequencia = 0;

    const harness = createTestRunner(provider);
    runner = harness.runner;
    conversations = harness.conversations;
    playbooks = harness.playbooks;

    await harness.policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);

    await rawDb.account.create({
      data: { id: ACCOUNT_ID, name: 'Plataforma', slug: 'plataforma-playbook' },
    });
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function escrever(output = OUTPUT) {
    provider.script({ respond: output });

    const conversa = await conversations.create(tenant(), {
      id: `01CONVPBK00000000000000${(sequencia += 1)}`,
      scope: 'PLAYBOOK',
      scopeId: null,
      title: null,
    });

    return runner.run(tenant(), {
      conversationId: conversa.id,
      operation: CREATE_PLAYBOOK,
      userMessage: 'Escreva o playbook de recepção de clínica.',
    });
  }

  it('o ofício NASCE, com chave, tese e princípios', async () => {
    const resultado = await escrever();

    expect(resultado.entityId).toBe('reception.clinic');

    const gravado = await playbooks.findByKey('reception.clinic');

    expect(gravado).not.toBeNull();
    expect(gravado?.label).toBe('Recepção de clínica');
    expect(gravado?.thesis).toContain('acolher');
    expect(gravado?.principles.length).toBeGreaterThanOrEqual(3);
    expect(gravado?.antiPatterns.length).toBeGreaterThanOrEqual(1);
    expect(gravado?.worthAsking.length).toBeGreaterThanOrEqual(1);
  });

  it('entra no CATÁLOGO — é o que faz o classificador passar a enxergá-lo', async () => {
    await escrever();

    const catalogo = await playbooks.listCurrent();

    // O ponto de todo o resto: sem estar no catálogo, o ofício existe e nenhum
    // agente nasce com ele.
    expect(catalogo.map((playbook) => playbook.key)).toContain('reception.clinic');
    expect(catalogo.find((playbook) => playbook.key === 'reception.clinic')?.appliesTo).toContain(
      'recepcionista de clínica',
    );
  });

  it('nasce VERSIONADO na v1, como todo agregado do sistema', async () => {
    await escrever();

    const historico = await playbooks.history('reception.clinic');

    expect(historico).toHaveLength(1);
    expect(historico[0]?.versionNumber).toBe(1);
    expect(historico[0]?.reason).toContain('recepção de clínica');
  });

  it('a criação fica AUDITADA — quem escreveu o ofício de todo mundo', async () => {
    await escrever();

    const auditoria = await rawDb.auditLog.findFirst({
      where: { action: 'PLAYBOOK_CREATED' },
    });

    expect(auditoria).not.toBeNull();
    expect(auditoria?.entityId).toBe('reception.clinic');
    expect(auditoria?.actorUserId).toBe(USER_ID);
  });

  it('a faceta declarada sobrevive: é ela que dá o alvo por faceta ao projetista', async () => {
    await escrever();

    const gravado = await playbooks.findByKey('reception.clinic');
    const facetas = new Set(gravado?.principles.map((principio) => principio.facet));

    // Sem a faceta o projetista distribui como quiser e para na cobertura
    // mínima — foi o que já custou catorze princípios virarem nove itens.
    expect(facetas.has('behaviors')).toBe(true);
    expect(facetas.has('hardRules')).toBe(true);
    expect(facetas.has('communication')).toBe(true);
  });

  it('SEM chave, nada é gravado: ofício com endereço-marcador é pior que erro', async () => {
    const semChave = JSON.parse(OUTPUT) as Record<string, unknown>;
    delete (semChave['identity'] as Record<string, unknown>)['key'];

    // Um ofício na chave-marcador entraria no catálogo e a próxima criação o
    // sobrescreveria — duas curadorias diferentes no mesmo endereço.
    await expect(escrever(JSON.stringify(semChave))).rejects.toThrow();

    expect(await playbooks.findByKey('novo.playbook')).toBeNull();
  });

  it('a chave de um ofício EXISTENTE não muda', async () => {
    await escrever();

    // Renomear órfãozaria a proveniência: todo agente daquele papel carrega
    // `playbookKey`, e é por ela que o refinamento acha o ofício certo.
    const renomeando = JSON.parse(OUTPUT) as Record<string, unknown>;
    (renomeando['identity'] as Record<string, unknown>)['key'] = 'outra.chave';
    (renomeando['identity'] as Record<string, unknown>)['label'] = 'Renomeado';

    await escrever(JSON.stringify(renomeando));

    expect(await playbooks.findByKey('outra.chave')).toBeNull();
    expect(await playbooks.findByKey('reception.clinic')).not.toBeNull();
  });
});
