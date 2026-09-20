import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ConversationService } from '../src/modules/conversations/application/conversation.service.js';
import { PrismaSessionRepository } from '../src/modules/conversations/infrastructure/prisma-conversation.repository.js';
import { PrismaMetricsRepository } from '../src/modules/metrics/infrastructure/prisma-metrics.repository.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import { UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import { closeTestResources, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTCONV000000000001';
const OTHER_ACCOUNT = '01ACCOUNTCONV000000000002';
const AGENT_ID = '01AGENTCONV00000000000001';

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return {
    accountId,
    userId: '01USERCONV000000000000001',
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

/**
 * Conversas persistidas (Fase 8) e o que a Fase 10 mede a partir delas.
 *
 * Contra banco real porque o que se prova aqui é transacional: o `seq` das duas
 * falas, os contadores da sessão e os eventos precisam sair de UMA transação —
 * e um dublê otimista transformaria em verde justamente o caso que interessa.
 */
describe.skipIf(!enabled)('conversas e métricas', () => {
  const ids = new UlidGenerator();
  const sessions = new PrismaSessionRepository(rawDb as never);
  const service = new ConversationService({ sessions, ids });

  beforeEach(async () => {
    await resetDatabase();

    for (const accountId of [ACCOUNT_ID, OTHER_ACCOUNT]) {
      await rawDb.account.create({
        data: { id: accountId, name: `Conta ${accountId.slice(-1)}`, slug: `conta-${accountId}` },
      });
    }
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function abrir(overrides: { channel?: 'PUBLIC' | 'LAB'; campaignId?: string | null } = {}) {
    return service.resolveSession(tenant(), {
      sessionId: null,
      channel: overrides.channel ?? 'PUBLIC',
      agentId: AGENT_ID,
      campaignId: overrides.campaignId ?? null,
      deploymentId: null,
      projectId: null,
      scenario: null,
    });
  }

  const TURNO = {
    reply: 'Posso ajudar com isso.',
    violations: [],
    ctaUrl: null,
    hadVisitorMessage: true,
  };

  it('a sessão nasce com estado e com o evento de início', async () => {
    const session = await abrir();

    const estado = await sessions.state(tenant(), session.id);
    expect(estado).not.toBeNull();

    const eventos = await rawDb.sessionEvent.findMany({ where: { sessionId: session.id } });
    expect(eventos.map((evento) => evento.type)).toEqual(['SESSION_STARTED']);
  });

  it('grava as DUAS falas do turno, em sequência', async () => {
    const session = await abrir();

    await service.recordTurn(tenant(), {
      session,
      visitorMessage: 'vocês fazem peça em inox?',
      turn: TURNO,
      usage: { totalTokens: 120, costMicros: 40 },
      aiCallId: null,
      statePatch: null,
    });

    const falas = await sessions.history(tenant(), session.id, 10);

    expect(falas.map((fala) => fala.role)).toEqual(['VISITOR', 'AGENT']);
    expect(falas.map((fala) => fala.seq)).toEqual([1, 2]);
    expect(falas[0]?.content).toBe('vocês fazem peça em inox?');
  });

  it('o histórico devolve as ÚLTIMAS falas, em ordem cronológica', async () => {
    const session = await abrir();

    for (const numero of [1, 2, 3]) {
      await service.recordTurn(tenant(), {
        session,
        visitorMessage: `pergunta ${numero}`,
        turn: { ...TURNO, reply: `resposta ${numero}` },
        usage: { totalTokens: 10, costMicros: 1 },
        aiCallId: null,
        statePatch: null,
      });
    }

    // Janela de 2: precisa trazer o FIM da conversa, não o começo. Trazer o
    // começo daria ao modelo o que já passou e esconderia o que acabou de ser dito.
    const janela = await service.history(tenant(), session.id);
    expect(janela.at(-1)?.content).toBe('resposta 3');

    const curta = await sessions.history(tenant(), session.id, 2);
    expect(curta.map((fala) => fala.content)).toEqual(['pergunta 3', 'resposta 3']);
  });

  it('os contadores da sessão acompanham o turno', async () => {
    const session = await abrir();

    await service.recordTurn(tenant(), {
      session,
      visitorMessage: 'oi',
      turn: { ...TURNO, violations: [{ check: 'forbid_urls_outside', message: 'link' }] },
      usage: { totalTokens: 200, costMicros: 75 },
      aiCallId: null,
      statePatch: null,
    });

    const recarregada = await sessions.findById(tenant(), session.id);

    expect(recarregada?.messageCount).toBe(2);
    expect(recarregada?.totalTokens).toBe(200);
    expect(recarregada?.costMicros).toBe(75);
    expect(recarregada?.violationCount).toBe(1);
  });

  it('a abertura grava UMA fala, não duas', async () => {
    const session = await abrir();

    await service.recordTurn(tenant(), {
      session,
      visitorMessage: null,
      turn: { ...TURNO, hadVisitorMessage: false, reply: 'Olá! Como posso ajudar?' },
      usage: { totalTokens: 0, costMicros: 0 },
      aiCallId: null,
      statePatch: null,
    });

    const falas = await sessions.history(tenant(), session.id, 10);
    expect(falas).toHaveLength(1);
    expect(falas[0]?.role).toBe('AGENT');
  });

  it('sessão de OUTRA conta não é alcançável', async () => {
    const session = await abrir();

    expect(await sessions.findById(tenant(OTHER_ACCOUNT), session.id)).toBeNull();
    expect(await sessions.history(tenant(OTHER_ACCOUNT), session.id, 10)).toEqual([]);
  });

  it('retomar com o id de outro agente é RECUSADO', async () => {
    const session = await abrir();

    await expect(
      service.resolveSession(tenant(), {
        sessionId: session.id,
        channel: 'PUBLIC',
        agentId: '01AGENTOUTRO0000000000001',
        campaignId: null,
        deploymentId: null,
        projectId: null,
        scenario: null,
      }),
    ).rejects.toThrow();
  });

  it('o estado é MERGE, nunca substituição', async () => {
    const session = await abrir();

    await service.recordTurn(tenant(), {
      session,
      visitorMessage: 'sou comprador da Metalúrgica X',
      turn: TURNO,
      usage: { totalTokens: 10, costMicros: 1 },
      aiCallId: null,
      statePatch: {
        facts: [{ key: 'company', value: 'Metalúrgica X' }],
        signals: [],
      },
    });

    await service.recordTurn(tenant(), {
      session,
      visitorMessage: 'preciso para agosto',
      turn: TURNO,
      usage: { totalTokens: 10, costMicros: 1 },
      aiCallId: null,
      statePatch: {
        facts: [{ key: 'deadline', value: 'agosto' }],
        signals: [{ kind: 'URGENCY', note: 'prazo curto' }],
      },
    });

    const estado = await sessions.state(tenant(), session.id);

    expect(estado?.facts).toHaveLength(2);
    expect(estado?.signals).toHaveLength(1);
  });
});

/**
 * O dashboard, contra dados reais.
 *
 * O que se prova aqui é o recorte: o Lab persiste conversa e NÃO pode aparecer
 * na métrica. Sem este teste, a primeira sessão de testes de alguém inflaria o
 * relatório de conversas com o cliente e ninguém saberia dizer por quê.
 */
describe.skipIf(!enabled)('métricas', () => {
  const ids = new UlidGenerator();
  const sessions = new PrismaSessionRepository(rawDb as never);
  const service = new ConversationService({ sessions, ids });
  const metrics = new PrismaMetricsRepository(rawDb as never);

  const JANELA = (() => {
    const to = new Date();
    to.setUTCHours(0, 0, 0, 0);
    to.setUTCDate(to.getUTCDate() + 1);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 30);
    return { from: from.toISOString(), to: to.toISOString() };
  })();

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.create({
      data: { id: ACCOUNT_ID, name: 'Conta', slug: 'conta-metricas' },
    });
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function conversar(channel: 'PUBLIC' | 'LAB', falas: number) {
    const session = await service.resolveSession(tenant(), {
      sessionId: null,
      channel,
      agentId: AGENT_ID,
      campaignId: null,
      deploymentId: null,
      projectId: null,
      scenario: null,
    });

    for (let numero = 1; numero <= falas; numero += 1) {
      await service.recordTurn(tenant(), {
        session,
        visitorMessage: `fala ${numero}`,
        turn: {
          reply: `resposta ${numero}`,
          violations: [],
          ctaUrl: null,
          hadVisitorMessage: true,
        },
        usage: { totalTokens: 100, costMicros: 25 },
        aiCallId: null,
        statePatch: null,
      });
    }

    return session;
  }

  it('o LAB não entra na métrica', async () => {
    await conversar('LAB', 3);
    await conversar('PUBLIC', 2);

    const overview = await metrics.overview(tenant(), JANELA, {});

    // Duas sessões existem; só uma é conversa com gente de verdade.
    expect(overview.totals.sessions).toBe(1);
  });

  it('conversa de UMA fala não conta como engajada', async () => {
    await conversar('PUBLIC', 1);
    await conversar('PUBLIC', 3);

    const overview = await metrics.overview(tenant(), JANELA, {});

    expect(overview.totals.sessions).toBe(2);
    expect(overview.totals.engagedSessions).toBe(1);
  });

  it('soma custo e tokens do que aconteceu de fato', async () => {
    await conversar('PUBLIC', 2);

    const overview = await metrics.overview(tenant(), JANELA, {});

    expect(overview.totals.totalTokens).toBe(200);
    expect(overview.totals.costMicros).toBe(50);
  });

  it('agrega violação por CHECKER, com a contagem', async () => {
    const session = await service.resolveSession(tenant(), {
      sessionId: null,
      channel: 'PUBLIC',
      agentId: AGENT_ID,
      campaignId: null,
      deploymentId: null,
      projectId: null,
      scenario: null,
    });

    for (const numero of [1, 2]) {
      await service.recordTurn(tenant(), {
        session,
        visitorMessage: `fala ${numero}`,
        turn: {
          reply: 'link proibido',
          violations: [{ check: 'forbid_urls_outside', message: 'link externo' }],
          ctaUrl: null,
          hadVisitorMessage: true,
        },
        usage: { totalTokens: 10, costMicros: 1 },
        aiCallId: null,
        statePatch: null,
      });
    }

    const overview = await metrics.overview(tenant(), JANELA, {});

    expect(overview.violations).toHaveLength(1);
    expect(overview.violations[0]).toMatchObject({ check: 'forbid_urls_outside', count: 2 });
  });

  it('a série cobre todos os dias do intervalo, inclusive os vazios', async () => {
    await conversar('PUBLIC', 1);

    const overview = await metrics.overview(tenant(), JANELA, {});

    // Sem os dias vazios, o gráfico emenda uma semana movimentada com a
    // seguinte e esconde a queda.
    expect(overview.series).toHaveLength(30);
    expect(overview.series.reduce((soma, ponto) => soma + ponto.sessions, 0)).toBe(1);
  });

  it('sem conversa nenhuma responde zerado, não quebra', async () => {
    const overview = await metrics.overview(tenant(), JANELA, {});

    expect(overview.totals.sessions).toBe(0);
    expect(overview.campaigns).toEqual([]);
    expect(overview.violations).toEqual([]);
  });
});
