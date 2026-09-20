import type { HubEvent, HubScope } from '@myaihub/shared';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import { agentPlaybookSchema, type AgentPlaybook } from '../domain/playbook.js';
import type {
  HubConversationRecord,
  HubConversationRepository,
  HubMessageRecord,
  HubOperationRepository,
  PlaybookRepository,
  PolicyRepository,
  PolicyVersion,
  SupportRepository,
  SystemLimitationRecord,
} from '../domain/repositories.js';

export class PrismaPolicyRepository implements PolicyRepository {
  constructor(private readonly db: Db) {}

  async getCurrent(name: string): Promise<PolicyVersion | null> {
    const policy = await this.db.hubPolicy.findUnique({ where: { name } });
    if (!policy?.currentVersionId) return null;

    const version = await this.db.hubPolicyVersion.findUnique({
      where: { id: policy.currentVersionId },
    });
    if (!version) return null;

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      sections: version.sections as Record<string, string>,
    };
  }

  /**
   * Cria a v1 se não existir. NÃO atualiza uma policy já gravada: a partir da
   * primeira escrita, a fonte de verdade é o banco, e um deploy não pode
   * sobrescrever em silêncio uma policy que foi ajustada (§27).
   */
  async ensureSeeded(name: string, sections: Record<string, string>): Promise<PolicyVersion> {
    const existing = await this.getCurrent(name);
    if (existing) return existing;

    return this.db.$transaction(async (tx) => {
      const policy = await tx.hubPolicy.upsert({
        where: { name },
        update: {},
        create: { id: ulid(), name },
      });

      const version = await tx.hubPolicyVersion.create({
        data: {
          id: ulid(),
          policyId: policy.id,
          versionNumber: 1,
          sections: sections as unknown as Prisma.InputJsonValue,
          reason: 'Seed inicial da Master Policy do MyAIHub OS.',
        },
      });

      await tx.hubPolicy.update({
        where: { id: policy.id },
        data: { currentVersionId: version.id },
      });

      return { id: version.id, versionNumber: 1, sections };
    });
  }

  async syncSections(
    name: string,
    sections: Record<string, string>,
  ): Promise<{ version: PolicyVersion; added: string[]; updated: string[] }> {
    const current = await this.ensureSeeded(name, sections);

    const added = Object.keys(sections).filter((key) => !(key in current.sections));
    const updated = Object.keys(sections).filter(
      (key) => key in current.sections && current.sections[key] !== sections[key],
    );

    if (added.length === 0 && updated.length === 0) {
      return { version: current, added: [], updated: [] };
    }

    return this.db.$transaction(async (tx) => {
      const policy = await tx.hubPolicy.findUniqueOrThrow({ where: { name } });

      // O seed é o autor: não há outro. Seção que existe só no banco (removida
      // do arquivo) é preservada — apagar orientação por omissão seria pior que
      // manter texto velho, porque uma operação pode declará-la.
      const merged: Record<string, string> = { ...current.sections, ...sections };

      const motivo = [
        added.length > 0 ? `novas: ${added.join(', ')}` : '',
        updated.length > 0 ? `atualizadas: ${updated.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      const versionNumber = current.versionNumber + 1;
      const version = await tx.hubPolicyVersion.create({
        data: {
          id: ulid(),
          policyId: policy.id,
          versionNumber,
          sections: merged as unknown as Prisma.InputJsonValue,
          reason: `Seed: ${motivo}.`,
        },
      });

      await tx.hubPolicy.update({
        where: { id: policy.id },
        data: { currentVersionId: version.id },
      });

      return { version: { id: version.id, versionNumber, sections: merged }, added, updated };
    });
  }
}

export class PrismaHubConversationRepository implements HubConversationRepository {
  constructor(private readonly db: Db) {}

  async create(
    context: TenantContext,
    input: { id: string; scope: HubScope; scopeId: string | null; title: string | null },
  ): Promise<HubConversationRecord> {
    const row = await this.db.hubConversation.create({
      data: {
        id: input.id,
        accountId: context.accountId,
        userId: context.userId ?? '',
        scope: input.scope,
        scopeId: input.scopeId,
        title: input.title,
      },
    });

    return {
      id: row.id,
      accountId: row.accountId,
      userId: row.userId,
      scope: row.scope,
      scopeId: row.scopeId,
      title: row.title,
    };
  }

  async findById(context: TenantContext, id: string): Promise<HubConversationRecord | null> {
    const row = await this.db.hubConversation.findFirst({
      where: { id, accountId: context.accountId },
    });
    if (!row) return null;

    return {
      id: row.id,
      accountId: row.accountId,
      userId: row.userId,
      scope: row.scope,
      scopeId: row.scopeId,
      title: row.title,
    };
  }

  async listMessages(
    context: TenantContext,
    conversationId: string,
    limit: number,
  ): Promise<HubMessageRecord[]> {
    /*
      As ÚLTIMAS `limit`, em ordem cronológica.

      Era `asc` + `take`: as PRIMEIRAS. Numa conversa curta dá no mesmo, e foi
      por isso que passou. Numa longa, o runner mandava ao modelo o começo da
      conversa como se fosse o "histórico recente" — a escalada de correção
      contava queixas de uma hora atrás — e o roteador lia quatro falas antigas
      em vez das últimas: "o único que tem" chegava sem a pergunta a que
      respondia, e ele perguntava de novo.

      `id` desempata: ULID é monotônico, e duas falas no mesmo milissegundo
      (a do usuário e a resposta imediata de uma ação) trocariam de ordem.
    */
    const rows = await this.db.hubMessage.findMany({
      where: { conversationId, accountId: context.accountId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    rows.reverse();

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      attachments: Array.isArray(row.attachments) ? (row.attachments as string[]) : [],
      createdAt: row.createdAt,
    }));
  }

  async appendMessage(
    context: TenantContext,
    input: {
      id: string;
      conversationId: string;
      role: 'USER' | 'ASSISTANT';
      content: string;
      /** Ids de MediaAsset colados junto da fala. */
      attachments?: string[];
    },
  ): Promise<HubMessageRecord> {
    const row = await this.db.hubMessage.create({
      data: {
        id: input.id,
        accountId: context.accountId,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      },
    });

    await this.db.hubConversation.updateMany({
      where: { id: input.conversationId, accountId: context.accountId },
      data: { updatedAt: new Date() },
    });

    return {
      id: row.id,
      role: row.role,
      content: row.content,
      attachments: input.attachments ?? [],
      createdAt: row.createdAt,
    };
  }
}

/**
 * Eventos de operação, com escrita em LOTE.
 *
 * Uma operação do OS emite ~20 eventos, e cada um virava uma ida ao banco:
 * ~20 escritas sequenciais por operação, com o MySQL em Docker num disco
 * mecânico. Era o maior custo isolado da suíte de integração.
 *
 * O buffer não pode virar "grava depois": o SSE reenvia o histórico a partir
 * de `Last-Event-ID`, e um evento ainda na memória sumiria para quem
 * reconectasse no meio. Por isso o `flush` acontece nos DOIS pontos em que
 * alguém pode LER: antes de listar o histórico e ao encerrar a operação.
 * Entre esses pontos, ninguém consegue observar a diferença — desde que o
 * `operation.completed` seja emitido ANTES de `finish`, que é o que garante
 * que o último evento entra no lote. O runner depende disso.
 */
export class PrismaHubOperationRepository implements HubOperationRepository {
  constructor(private readonly db: Db) {}

  private readonly pending = new Map<string, Prisma.HubOperationEventCreateManyInput[]>();

  /** Grava o que estiver em memória para esta operação. */
  private async flush(operationId: string): Promise<void> {
    const rows = this.pending.get(operationId);
    if (!rows?.length) return;

    // Remove ANTES de gravar: se a escrita falhar, tentar de novo os mesmos
    // ids violaria a chave primária e transformaria um erro de banco em erro
    // permanente da operação.
    this.pending.delete(operationId);
    await this.db.hubOperationEvent.createMany({ data: rows });
  }

  async start(
    context: TenantContext,
    input: {
      id: string;
      conversationId: string;
      operation: string;
      triggeredByMessageId: string;
      policyVersionId: string | null;
      policySections: string[];
    },
  ): Promise<void> {
    await this.db.hubOperation.create({
      data: {
        id: input.id,
        accountId: context.accountId,
        conversationId: input.conversationId,
        operation: input.operation,
        triggeredByMessageId: input.triggeredByMessageId,
        policyVersionId: input.policyVersionId,
        policySections: input.policySections as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async finish(
    context: TenantContext,
    input: {
      id: string;
      status: 'COMPLETED' | 'FAILED' | 'AWAITING_CONFIRMATION';
      errorCode?: string;
    },
  ): Promise<void> {
    // A operação acabou: nada mais será emitido, e o histórico precisa estar
    // completo no banco antes de alguém pedir o replay.
    await this.flush(input.id);

    await this.db.hubOperation.updateMany({
      where: { id: input.id, accountId: context.accountId },
      data: {
        status: input.status,
        errorCode: input.errorCode ?? null,
        completedAt: new Date(),
      },
    });
  }

  async appendEvent(
    context: TenantContext,
    input: { id: string; operationId: string; event: HubEvent },
  ): Promise<void> {
    const rows = this.pending.get(input.operationId) ?? [];
    rows.push({
      id: input.id,
      accountId: context.accountId,
      operationId: input.operationId,
      seq: input.event.seq,
      payload: input.event as unknown as Prisma.InputJsonValue,
    });
    this.pending.set(input.operationId, rows);

    // Um lote grande demais atrasaria a primeira leitura de quem reconecta.
    if (rows.length >= 25) await this.flush(input.operationId);
  }

  async listEvents(
    context: TenantContext,
    operationId: string,
    afterSeq: number,
  ): Promise<HubEvent[]> {
    // O replay é o único leitor, e ele não pode ver menos do que já foi
    // emitido — senão o painel volta de um refresh com o checklist pela metade.
    await this.flush(operationId);

    const rows = await this.db.hubOperationEvent.findMany({
      where: { operationId, accountId: context.accountId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
    });

    return rows.map((row) => row.payload as unknown as HubEvent);
  }
}

/**
 * Playbooks de ofício, com a MESMA disciplina da Master Policy.
 *
 * Semente é semente: cria o que falta e nunca toca no que já existe, porque o
 * admin pode ter editado. Um deploy que sobrescreve a curadoria dele em
 * silêncio seria pior que não semear nada.
 */
export class PrismaPlaybookRepository implements PlaybookRepository {
  constructor(private readonly db: Db) {}

  private parse(content: unknown, key: string): AgentPlaybook | null {
    const parsed = agentPlaybookSchema.safeParse(content);
    // Playbook gravado inválido não pode derrubar a criação de agente: sem ele
    // o OS volta ao comportamento genérico, que é pior mas continua de pé.
    if (!parsed.success) return null;
    return { ...parsed.data, key };
  }

  async listCurrent(): Promise<AgentPlaybook[]> {
    const rows = await this.db.playbook.findMany({
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      orderBy: { key: 'asc' },
    });

    return rows.flatMap((row) => {
      const current = row.versions[0];
      if (!current) return [];
      const parsed = this.parse(current.content, row.key);
      return parsed ? [parsed] : [];
    });
  }

  async findByKey(key: string): Promise<AgentPlaybook | null> {
    return (await this.findCurrent(key))?.playbook ?? null;
  }

  async findCurrent(
    key: string,
  ): Promise<{ playbook: AgentPlaybook; versionNumber: number } | null> {
    const row = await this.db.playbook.findUnique({
      where: { key },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    const current = row?.versions[0];
    if (!row || !current) return null;

    const playbook = this.parse(current.content, row.key);
    return playbook ? { playbook, versionNumber: current.versionNumber } : null;
  }

  async seedMissing(playbooks: readonly AgentPlaybook[]): Promise<string[]> {
    const rows = await this.db.playbook.findMany({
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    const stored = new Map(rows.map((row) => [row.key, row]));
    const written: string[] = [];

    for (const playbook of playbooks) {
      const row = stored.get(playbook.key);
      const current = row?.versions[0];

      // Playbook já curado pelo admin não é tocado — a semente é semente.
      // Mas uma versão gravada que NÃO bate mais com o schema (o formato mudou
      // desde que ela foi escrita) é inútil: o leitor a descarta e o OS volta a
      // projetar sem ofício, em silêncio. Aí a semente vale mais que ela.
      if (row && current && agentPlaybookSchema.safeParse(current.content).success) continue;

      await this.db.$transaction(async (tx) => {
        const target =
          row ?? (await tx.playbook.create({ data: { id: ulid(), key: playbook.key } }));

        const versionNumber = (current?.versionNumber ?? 0) + 1;
        const version = await tx.playbookVersion.create({
          data: {
            id: ulid(),
            playbookId: target.id,
            versionNumber,
            content: playbook as unknown as Prisma.InputJsonValue,
            reason:
              versionNumber === 1
                ? 'Semente inicial do playbook.'
                : 'A versão anterior não batia com o formato atual; ressemeada.',
          },
        });

        await tx.playbook.update({
          where: { id: target.id },
          data: { currentVersionId: version.id },
        });
      });

      written.push(playbook.key);
    }

    return written;
  }

  async recordMiss(context: TenantContext, role: string): Promise<void> {
    await this.db.playbookMiss.create({
      data: {
        id: ulid(),
        accountId: context.accountId,
        // O papel é texto livre do usuário; o limite da coluna é 300.
        role: role.slice(0, 300),
      },
    });
  }

  async recordSuggestion(
    context: TenantContext,
    input: {
      playbookKey: string;
      agentId: string;
      summary: string;
      statement: string;
      facet: string;
    },
  ): Promise<void> {
    await this.db.playbookSuggestion.create({
      data: {
        id: ulid(),
        accountId: context.accountId,
        playbookKey: input.playbookKey,
        agentId: input.agentId,
        summary: input.summary.slice(0, 300),
        statement: input.statement,
        facet: input.facet.slice(0, 30),
      },
    });
  }

  // --- administração da plataforma ---------------------------------------

  async listForAdmin(): Promise<
    Array<{ playbook: AgentPlaybook; versionNumber: number; updatedAt: Date }>
  > {
    const rows = await this.db.playbook.findMany({
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      orderBy: { key: 'asc' },
    });

    return rows.flatMap((row) => {
      const current = row.versions[0];
      if (!current) return [];
      const parsed = this.parse(current.content, row.key);
      // Playbook ilegível ainda aparece para o admin? Não: ele não está em uso,
      // e mostrá-lo como se estivesse esconderia o problema real.
      if (!parsed) return [];
      return [
        { playbook: parsed, versionNumber: current.versionNumber, updatedAt: current.createdAt },
      ];
    });
  }

  async saveVersion(key: string, playbook: AgentPlaybook, reason: string): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const row =
        (await tx.playbook.findUnique({
          where: { key },
          include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
        })) ?? null;

      const target = row ?? (await tx.playbook.create({ data: { id: ulid(), key } }));
      const versionNumber = (row?.versions[0]?.versionNumber ?? 0) + 1;

      const version = await tx.playbookVersion.create({
        data: {
          id: ulid(),
          playbookId: target.id,
          versionNumber,
          content: { ...playbook, key } as unknown as Prisma.InputJsonValue,
          reason: reason.slice(0, 300),
        },
      });

      await tx.playbook.update({
        where: { id: target.id },
        data: { currentVersionId: version.id },
      });

      return versionNumber;
    });
  }

  async history(
    key: string,
  ): Promise<Array<{ versionNumber: number; reason: string; createdAt: Date }>> {
    const row = await this.db.playbook.findUnique({
      where: { key },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });

    return (row?.versions ?? []).map((version) => ({
      versionNumber: version.versionNumber,
      reason: version.reason,
      createdAt: version.createdAt,
    }));
  }

  async listSuggestions(
    playbookKey: string,
    limit: number,
  ): Promise<Array<{ summary: string; statement: string; facet: string; createdAt: Date }>> {
    const rows = await this.db.playbookSuggestion.findMany({
      where: { playbookKey },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      summary: row.summary,
      statement: row.statement,
      facet: row.facet,
      createdAt: row.createdAt,
    }));
  }

  async countAgentsByPlaybook(): Promise<Record<string, number>> {
    const rows = await this.db.agent.groupBy({
      by: ['playbookKey'],
      _count: { playbookKey: true },
    });

    return Object.fromEntries(
      rows
        .filter((row) => row.playbookKey)
        .map((row) => [row.playbookKey as string, row._count.playbookKey]),
    );
  }

  async listMisses(limit: number): Promise<Array<{ role: string; count: number; lastSeen: Date }>> {
    // Agrupado por papel: a mesma frase repetida vinte vezes é UMA pauta com
    // peso vinte, não vinte linhas para o admin ler.
    const rows = await this.db.playbookMiss.groupBy({
      by: ['role'],
      _count: { role: true },
      _max: { createdAt: true },
      orderBy: { _count: { role: 'desc' } },
      take: limit,
    });

    return rows.map((row) => ({
      role: row.role,
      count: row._count.role,
      lastSeen: row._max.createdAt ?? new Date(0),
    }));
  }
}

export class PrismaSupportRepository implements SupportRepository {
  constructor(private readonly db: Db) {}

  async recordLimitation(
    context: TenantContext,
    input: {
      hubOperationId: string | null;
      operation: string;
      summary: string;
      need: string;
      userMessage: string;
    },
  ): Promise<void> {
    await this.db.systemLimitation.create({
      data: {
        id: ulid(),
        accountId: context.accountId,
        userId: context.userId,
        hubOperationId: input.hubOperationId,
        operation: input.operation.slice(0, 60),
        summary: input.summary.slice(0, 300),
        need: input.need.slice(0, 600),
        // É contexto para quem vai corrigir, não o transcrito: o começo basta.
        userMessage: input.userMessage.slice(0, 1000),
      },
    });
  }

  async listLimitations(
    _context: TenantContext,
    filter: { status?: 'OPEN' | 'RESOLVED' },
    limit: number,
  ): Promise<SystemLimitationRecord[]> {
    const rows = await this.db.systemLimitation.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      operation: row.operation,
      summary: row.summary,
      need: row.need,
      userMessage: row.userMessage,
      status: row.status,
      resolutionNote: row.resolutionNote,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    }));
  }

  async resolveLimitation(_context: TenantContext, id: string, note: string): Promise<boolean> {
    // `updateMany`: o admin resolve na plataforma inteira (contexto elevado), e
    // a forma singular é barrada pela varredura de escrita sem tenant.
    const updated = await this.db.systemLimitation.updateMany({
      where: { id },
      data: { status: 'RESOLVED', resolutionNote: note.slice(0, 600), resolvedAt: new Date() },
    });
    return updated.count > 0;
  }
}
