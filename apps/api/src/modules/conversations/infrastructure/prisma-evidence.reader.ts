import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type { EvidenceReader, ViolationEvidence } from '../domain/evidence.js';

/** Quantas conversas recentes valem a leitura. Além disso é histórico, não sinal. */
const SESSIONS_WINDOW = 60;

export class PrismaEvidenceReader implements EvidenceReader {
  constructor(private readonly db: Db) {}

  async violationsByAgent(
    context: TenantContext,
    agentId: string,
    limit: number,
  ): Promise<ViolationEvidence[]> {
    // Só PUBLIC: violação no Lab é o usuário testando o limite de propósito, e
    // contá-la como falha de produção mandaria o OS corrigir um comportamento
    // que nenhum cliente viu.
    const sessions = await this.db.conversationSession.findMany({
      where: {
        accountId: context.accountId,
        agentId,
        channel: 'PUBLIC',
        violationCount: { gt: 0 },
      },
      orderBy: { startedAt: 'desc' },
      take: SESSIONS_WINDOW,
      select: { id: true },
    });

    if (sessions.length === 0) return [];

    const mensagens = await this.db.conversationMessage.findMany({
      where: {
        accountId: context.accountId,
        sessionId: { in: sessions.map((sessao) => sessao.id) },
        role: 'AGENT',
      },
      orderBy: { createdAt: 'desc' },
      select: { sessionId: true, seq: true, content: true, violations: true, createdAt: true },
    });

    const porCheck = new Map<string, ViolationEvidence>();

    for (const mensagem of mensagens) {
      const violacoes = Array.isArray(mensagem.violations)
        ? (mensagem.violations as Array<{ check?: string }>)
        : [];

      for (const violacao of violacoes) {
        const check = violacao.check;
        if (!check) continue;

        const existente = porCheck.get(check);
        if (existente) {
          existente.count += 1;
          continue;
        }

        // A pergunta que provocou a resposta. Sem ela o OS lê a fala do agente
        // fora de contexto e corrige o sintoma em vez do gatilho.
        const anterior = await this.db.conversationMessage.findFirst({
          where: {
            accountId: context.accountId,
            sessionId: mensagem.sessionId,
            seq: mensagem.seq - 1,
            role: 'VISITOR',
          },
          select: { content: true },
        });

        porCheck.set(check, {
          check,
          count: 1,
          sample: {
            prompt: anterior?.content ?? null,
            reply: mensagem.content,
            at: mensagem.createdAt,
          },
        });
      }
    }

    return [...porCheck.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }
}
