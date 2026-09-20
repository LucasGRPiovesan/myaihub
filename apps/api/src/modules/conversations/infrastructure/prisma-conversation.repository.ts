import { emptyConversationState, type ConversationStateView } from '@myaihub/shared';
import type { Prisma, SessionEventType } from '@prisma/client';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type {
  MessageRecord,
  RecordTurnInput,
  SessionRecord,
  SessionRepository,
  StartSessionInput,
} from '../domain/repositories.js';

type PrismaSession = Prisma.ConversationSessionGetPayload<Record<string, never>>;
type PrismaMessage = Prisma.ConversationMessageGetPayload<Record<string, never>>;

function toSession(row: PrismaSession): SessionRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    channel: row.channel,
    campaignId: row.campaignId,
    deploymentId: row.deploymentId,
    projectId: row.projectId,
    agentId: row.agentId,
    scenario: row.scenario,
    messageCount: row.messageCount,
    totalTokens: row.totalTokens,
    // BigInt não atravessa JSON. A conversão é aqui, na borda: espalhar
    // `Number(...)` por cada leitor é como um deles vira string em produção.
    costMicros: Number(row.costMicros),
    violationCount: row.violationCount,
    startedAt: row.startedAt,
    lastMessageAt: row.lastMessageAt,
  };
}

function toMessage(row: PrismaMessage): MessageRecord {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    violations: Array.isArray(row.violations)
      ? (row.violations as Array<{ check: string; message: string }>)
      : [],
    createdAt: row.createdAt,
  };
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async start(context: TenantContext, input: StartSessionInput): Promise<SessionRecord> {
    const row = await this.db.conversationSession.create({
      data: {
        id: input.id,
        accountId: context.accountId,
        channel: input.channel,
        campaignId: input.campaignId,
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        agentId: input.agentId,
        scenario: input.scenario,
        // O estado nasce junto: um 1:1 criado sob demanda produz o caminho em
        // que ele não existe, e esse caminho aparece só sob concorrência.
        state: {
          create: {
            accountId: context.accountId,
            facts: [],
            signals: [],
            progress: { percent: 0, objectiveReached: false },
          },
        },
        events: {
          create: {
            id: input.startEventId,
            accountId: context.accountId,
            type: 'SESSION_STARTED',
            source: 'OBSERVED',
            campaignId: input.campaignId,
          },
        },
      },
    });

    return toSession(row);
  }

  async findById(context: TenantContext, id: string): Promise<SessionRecord | null> {
    const row = await this.db.conversationSession.findFirst({
      where: { id, accountId: context.accountId },
    });
    return row ? toSession(row) : null;
  }

  async history(
    context: TenantContext,
    sessionId: string,
    limit: number,
  ): Promise<MessageRecord[]> {
    // As ÚLTIMAS `limit`, devolvidas em ordem cronológica: pegar as primeiras
    // daria ao modelo o começo da conversa e esconderia o que acabou de ser dito.
    const rows = await this.db.conversationMessage.findMany({
      where: { sessionId, accountId: context.accountId },
      orderBy: { seq: 'desc' },
      take: limit,
    });

    return rows.reverse().map(toMessage);
  }

  async state(context: TenantContext, sessionId: string): Promise<ConversationStateView | null> {
    const row = await this.db.conversationState.findFirst({
      where: { sessionId, accountId: context.accountId },
    });
    if (!row) return null;

    const base = emptyConversationState();
    return {
      facts: Array.isArray(row.facts) ? (row.facts as ConversationStateView['facts']) : base.facts,
      signals: Array.isArray(row.signals)
        ? (row.signals as ConversationStateView['signals'])
        : base.signals,
      progress:
        row.progress && typeof row.progress === 'object'
          ? (row.progress as ConversationStateView['progress'])
          : base.progress,
    };
  }

  /**
   * Um turno inteiro numa transação.
   *
   * O `seq` é lido dentro dela e as duas falas ocupam `seq` e `seq + 1`. Sem a
   * transação, dois turnos simultâneos na mesma sessão colidiriam no
   * `@@unique([sessionId, seq])` — e o segundo perderia a fala do visitante
   * depois de o modelo já ter sido pago.
   */
  async recordTurn(context: TenantContext, input: RecordTurnInput): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const last = await tx.conversationMessage.findFirst({
        where: { sessionId: input.sessionId, accountId: context.accountId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });

      let seq = (last?.seq ?? 0) + 1;

      if (input.visitor) {
        await tx.conversationMessage.create({
          data: {
            id: input.visitor.id,
            accountId: context.accountId,
            sessionId: input.sessionId,
            seq,
            role: 'VISITOR',
            content: input.visitor.content,
          },
        });
        seq += 1;
      }

      await tx.conversationMessage.create({
        data: {
          id: input.agent.id,
          accountId: context.accountId,
          sessionId: input.sessionId,
          seq,
          role: 'AGENT',
          content: input.agent.content,
          violations: input.agent.violations,
          aiCallId: input.agent.aiCallId,
        },
      });

      // `updateMany`, não `update`: numa tabela tenant-scoped um `where` sem
      // accountId é a forma exata do IDOR, e o tenantGuard barra — com razão.
      // Aqui pesa duplamente: quem escreve nesta tabela é o CHAT PÚBLICO, numa
      // rota sem usuário autenticado.
      await tx.conversationSession.updateMany({
        where: { id: input.sessionId, accountId: context.accountId },
        data: {
          messageCount: { increment: input.visitor ? 2 : 1 },
          totalTokens: { increment: input.usage.totalTokens },
          costMicros: { increment: BigInt(Math.round(input.usage.costMicros)) },
          violationCount: { increment: input.agent.violations.length },
          lastMessageAt: new Date(),
        },
      });

      if (input.events.length > 0) {
        const session = await tx.conversationSession.findFirst({
          where: { id: input.sessionId, accountId: context.accountId },
          select: { campaignId: true },
        });

        await tx.sessionEvent.createMany({
          data: input.events.map((event) => ({
            id: event.id,
            accountId: context.accountId,
            sessionId: input.sessionId,
            type: event.type,
            source: event.source,
            campaignId: session?.campaignId ?? null,
            payload: (event.payload ?? null) as Prisma.InputJsonValue,
          })),
        });
      }

      if (input.state) {
        await tx.conversationState.updateMany({
          where: { sessionId: input.sessionId, accountId: context.accountId },
          data: {
            facts: input.state.facts,
            signals: input.state.signals,
            progress: input.state.progress,
          },
        });
      }
    });
  }

  /**
   * O veredito do auditor, que chega depois do turno já gravado.
   *
   * Mesma transação para as três escritas — violações na fala, eventos e
   * contador da sessão — pelo mesmo motivo do turno: um estado em que a fala
   * mostra violação e o contador não a conta é um relatório que não fecha.
   */
  async attachAdherence(
    context: TenantContext,
    input: {
      sessionId: string;
      messageId: string;
      violations: Array<{ check: string; message: string }>;
      events: Array<{
        id: string;
        type: SessionEventType;
        source: 'OBSERVED' | 'DECLARED';
        payload?: Record<string, unknown>;
      }>;
      state: ConversationStateView | null;
    },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // `updateMany` com accountId: a forma singular passa verde na suíte de
      // integração (client cru, sem o guard) e explode em produção.
      await tx.conversationMessage.updateMany({
        where: { id: input.messageId, sessionId: input.sessionId, accountId: context.accountId },
        data: { violations: input.violations },
      });

      if (input.events.length > 0) {
        const session = await tx.conversationSession.findFirst({
          where: { id: input.sessionId, accountId: context.accountId },
          select: { campaignId: true },
        });

        await tx.sessionEvent.createMany({
          data: input.events.map((event) => ({
            id: event.id,
            accountId: context.accountId,
            sessionId: input.sessionId,
            type: event.type,
            source: event.source,
            campaignId: session?.campaignId ?? null,
            payload: (event.payload ?? null) as Prisma.InputJsonValue,
          })),
        });

        // O contador cresce só com o que ENTROU agora: as determinísticas já
        // foram contadas quando o turno foi gravado.
        const novas = input.events.filter((event) => event.type === 'RULE_VIOLATION').length;
        if (novas > 0) {
          await tx.conversationSession.updateMany({
            where: { id: input.sessionId, accountId: context.accountId },
            data: { violationCount: { increment: novas } },
          });
        }
      }

      if (input.state) {
        await tx.conversationState.updateMany({
          where: { sessionId: input.sessionId, accountId: context.accountId },
          data: {
            facts: input.state.facts,
            signals: input.state.signals,
            progress: input.state.progress,
          },
        });
      }
    });
  }

  async list(
    context: TenantContext,
    filter: {
      channel?: 'PUBLIC' | 'LAB';
      campaignId?: string;
      agentId?: string;
      limit: number;
      cursor: string | null;
    },
  ): Promise<SessionRecord[]> {
    const rows = await this.db.conversationSession.findMany({
      where: {
        accountId: context.accountId,
        ...(filter.channel ? { channel: filter.channel } : {}),
        ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(filter.agentId ? { agentId: filter.agentId } : {}),
        ...(filter.cursor ? { id: { lt: filter.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: filter.limit,
    });

    return rows.map(toSession);
  }
}
