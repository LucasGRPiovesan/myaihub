import type {
  CampaignMetricsRow,
  MetricsOverview,
  MetricsRange,
  MetricsSeriesPoint,
  ViolationRow,
} from '@myaihub/shared';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type { MetricsRepository } from '../domain/repositories.js';

/**
 * Teto de agregação.
 *
 * Dez mil conversas num recorte é muito além do que este produto vê hoje, e
 * baixo o bastante para a soma em memória continuar barata. Passado o teto, o
 * `truncated` avisa — a tela diz que está mostrando uma amostra, em vez de
 * apresentar um número incompleto como se fosse o total.
 */
const MAX_SESSIONS = 10_000;

/**
 * O dashboard, montado a partir das tabelas que já existem.
 *
 * Só o canal PUBLIC entra. O Lab persiste conversa (Fase 8) e fica de fora de
 * propósito: são dezenas de turnos de teste por dia, e misturá-los com
 * atendimento real faria o número de conversas subir sempre que alguém
 * estivesse trabalhando.
 *
 * A agregação é em JS sobre linhas já filtradas por tenant e por período, e não
 * em SQL cru. `$queryRaw` é barrado por lint aqui — ele escapa do tenantGuard
 * (invariante 3), e é justamente numa tela de relatório que uma consulta sem
 * escopo mostraria a conta de outra pessoa.
 */
export class PrismaMetricsRepository implements MetricsRepository {
  constructor(private readonly db: Db) {}

  async overview(
    context: TenantContext,
    range: MetricsRange,
    filter: { campaignId?: string; projectId?: string },
  ): Promise<MetricsOverview> {
    const from = new Date(range.from);
    const to = new Date(range.to);

    const campanhasDoProjeto = filter.projectId
      ? await this.db.campaign.findMany({
          where: { accountId: context.accountId, projectId: filter.projectId },
          select: { id: true },
        })
      : null;

    const escopo = {
      accountId: context.accountId,
      channel: 'PUBLIC' as const,
      startedAt: { gte: from, lt: to },
      ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
      ...(campanhasDoProjeto
        ? { campaignId: { in: campanhasDoProjeto.map((campanha) => campanha.id) } }
        : {}),
    };

    const encontradas = await this.db.conversationSession.findMany({
      where: escopo,
      // Uma a mais que o teto: é assim que se sabe que HÁ mais, sem uma
      // segunda consulta de contagem.
      take: MAX_SESSIONS + 1,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        campaignId: true,
        messageCount: true,
        totalTokens: true,
        costMicros: true,
        violationCount: true,
        startedAt: true,
      },
    });

    const truncated = encontradas.length > MAX_SESSIONS;
    const sessions = truncated ? encontradas.slice(0, MAX_SESSIONS) : encontradas;

    const sessionIds = sessions.map((session) => session.id);

    const events =
      sessionIds.length > 0
        ? await this.db.sessionEvent.findMany({
            where: { accountId: context.accountId, sessionId: { in: sessionIds } },
            select: {
              type: true,
              campaignId: true,
              sessionId: true,
              payload: true,
              createdAt: true,
            },
          })
        : [];

    return {
      range,
      truncated,
      totals: this.totals(sessions, events),
      series: this.series(sessions, events, from, to),
      campaigns: await this.campaigns(context, sessions, events),
      violations: this.violations(events),
    };
  }

  private totals(
    sessions: Array<{ messageCount: number; totalTokens: number; costMicros: bigint }>,
    events: Array<{ type: string; sessionId: string }>,
  ) {
    // "Engajada" = mais de uma fala do visitante. Uma fala só não é conversa, e
    // contar como se fosse infla toda taxa que use conversas como denominador.
    const falasPorSessao = new Map<string, number>();
    for (const event of events) {
      if (event.type !== 'MESSAGE_RECEIVED') continue;
      falasPorSessao.set(event.sessionId, (falasPorSessao.get(event.sessionId) ?? 0) + 1);
    }

    const turnos = sessions.map((session) => session.messageCount).sort((a, b) => a - b);

    return {
      sessions: sessions.length,
      messages: sessions.reduce((soma, session) => soma + session.messageCount, 0),
      engagedSessions: [...falasPorSessao.values()].filter((quantas) => quantas > 1).length,
      objectivesReached: events.filter((event) => event.type === 'OBJECTIVE_REACHED').length,
      violations: events.filter((event) => event.type === 'RULE_VIOLATION').length,
      costMicros: sessions.reduce((soma, session) => soma + Number(session.costMicros), 0),
      totalTokens: sessions.reduce((soma, session) => soma + session.totalTokens, 0),
      // MEDIANA, não média: a distribuição tem uma cauda de sessões de um turno
      // só (gente que abriu e fechou), e a média dela conta uma história falsa.
      medianTurns: turnos.length > 0 ? (turnos[Math.floor(turnos.length / 2)] ?? 0) : 0,
    };
  }

  private series(
    sessions: Array<{ startedAt: Date; messageCount: number; costMicros: bigint }>,
    events: Array<{ type: string; createdAt: Date }>,
    from: Date,
    to: Date,
  ): MetricsSeriesPoint[] {
    const dias = new Map<string, MetricsSeriesPoint>();

    // Todos os dias do intervalo, inclusive os vazios. Sem eles o gráfico
    // emenda uma semana movimentada com a seguinte e esconde a queda.
    for (let dia = new Date(from); dia < to; dia.setUTCDate(dia.getUTCDate() + 1)) {
      const chave = dia.toISOString().slice(0, 10);
      dias.set(chave, {
        day: chave,
        sessions: 0,
        messages: 0,
        objectivesReached: 0,
        violations: 0,
        costMicros: 0,
      });
    }

    for (const session of sessions) {
      const ponto = dias.get(session.startedAt.toISOString().slice(0, 10));
      if (!ponto) continue;
      ponto.sessions += 1;
      ponto.messages += session.messageCount;
      ponto.costMicros += Number(session.costMicros);
    }

    for (const event of events) {
      const ponto = dias.get(event.createdAt.toISOString().slice(0, 10));
      if (!ponto) continue;
      if (event.type === 'OBJECTIVE_REACHED') ponto.objectivesReached += 1;
      if (event.type === 'RULE_VIOLATION') ponto.violations += 1;
    }

    return [...dias.values()];
  }

  private async campaigns(
    context: TenantContext,
    sessions: Array<{
      id: string;
      campaignId: string | null;
      costMicros: bigint;
      violationCount: number;
    }>,
    events: Array<{ type: string; sessionId: string; campaignId: string | null }>,
  ): Promise<CampaignMetricsRow[]> {
    const ids = [...new Set(sessions.map((session) => session.campaignId).filter(Boolean))];
    if (ids.length === 0) return [];

    const campanhas = await this.db.campaign.findMany({
      where: { accountId: context.accountId, id: { in: ids as string[] } },
      select: { id: true, name: true, status: true, project: { select: { id: true, name: true } } },
    });

    const falasPorSessao = new Map<string, number>();
    for (const event of events) {
      if (event.type !== 'MESSAGE_RECEIVED') continue;
      falasPorSessao.set(event.sessionId, (falasPorSessao.get(event.sessionId) ?? 0) + 1);
    }

    return campanhas.map((campanha) => {
      const daCampanha = sessions.filter((session) => session.campaignId === campanha.id);
      const idsDaCampanha = new Set(daCampanha.map((session) => session.id));

      return {
        campaignId: campanha.id,
        campaignName: campanha.name,
        projectId: campanha.project.id,
        projectName: campanha.project.name,
        status: campanha.status,
        sessions: daCampanha.length,
        engagedSessions: daCampanha.filter((session) => (falasPorSessao.get(session.id) ?? 0) > 1)
          .length,
        objectivesReached: events.filter(
          (event) => event.type === 'OBJECTIVE_REACHED' && idsDaCampanha.has(event.sessionId),
        ).length,
        violations: daCampanha.reduce((soma, session) => soma + session.violationCount, 0),
        costMicros: daCampanha.reduce((soma, session) => soma + Number(session.costMicros), 0),
      };
    });
  }

  /**
   * Violações agregadas por CHECKER.
   *
   * Violar uma regra explicitamente HARD é falha crítica do MyAIHub, não do
   * usuário (§6.3). Por isso a tela mostra qual regra falha e quantas vezes —
   * é o que transforma "algo saiu errado" em "esta regra não está pegando".
   */
  private violations(
    events: Array<{ type: string; payload: unknown; createdAt: Date }>,
  ): ViolationRow[] {
    const porCheck = new Map<string, ViolationRow>();

    for (const event of events) {
      if (event.type !== 'RULE_VIOLATION') continue;

      const payload = event.payload as { check?: string; message?: string } | null;
      const check = payload?.check ?? 'desconhecido';
      const existente = porCheck.get(check);

      if (existente) {
        existente.count += 1;
        if (event.createdAt.toISOString() > existente.lastAt) {
          existente.lastAt = event.createdAt.toISOString();
          existente.sampleMessage = payload?.message ?? existente.sampleMessage;
        }
        continue;
      }

      porCheck.set(check, {
        check,
        count: 1,
        lastAt: event.createdAt.toISOString(),
        sampleMessage: payload?.message ?? '',
      });
    }

    return [...porCheck.values()].sort((a, b) => b.count - a.count);
  }
}
