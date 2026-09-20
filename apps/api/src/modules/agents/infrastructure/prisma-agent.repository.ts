import { AGENT_SCHEMAS, parseCanonical } from '@myaihub/shared';
import type { Prisma } from '@prisma/client';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { ConcurrencyError, ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Db, DbTx } from '../../../shared/infrastructure/prisma/client.js';
import {
  isUniqueViolationOn,
  withWriteConflictRetry,
} from '../../../shared/infrastructure/prisma/transaction.js';
import type { AgentMutation } from '../domain/mutations.js';
import type {
  AgentRecord,
  AgentRepository,
  AgentVersionRecord,
  AgentWithVersion,
  CreateAgentInput,
  UpdateAgentInput,
} from '../domain/repositories.js';

const MAX_SLUG_ATTEMPTS = 20;

type PrismaAgent = Prisma.AgentGetPayload<Record<string, never>>;
type PrismaVersion = Prisma.AgentVersionGetPayload<Record<string, never>>;

function toAgent(row: PrismaAgent): AgentRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    slug: row.slug,
    role: row.role,
    status: row.status,
    currentVersionId: row.currentVersionId,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
  };
}

function toVersion(row: PrismaVersion): AgentVersionRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    versionNumber: row.versionNumber,
    // Migra na leitura; o documento gravado não é reescrito (§5.3).
    canonicalConfig: parseCanonical(row.canonicalConfig, AGENT_SCHEMAS),
    humanSummary: Array.isArray(row.humanSummary) ? (row.humanSummary as string[]) : [],
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export class PrismaAgentRepository implements AgentRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditWriter,
  ) {}

  private async writeChange(
    tx: DbTx,
    accountId: string,
    change: {
      id: string;
      entityId: string;
      fromVersionId: string | null;
      fromVersion: number | null;
      toVersionId: string;
      toVersion: number;
      source: 'USER' | 'MYAIHUB' | 'SYSTEM';
      actorUserId: string | null;
      hubOperationId: string | null;
      hubMessageId: string | null;
      interpretedIntent: string;
      mutations: AgentMutation[];
      rationale: string;
    },
  ): Promise<void> {
    await tx.configurationChange.create({
      data: {
        id: change.id,
        accountId,
        entityType: 'AGENT',
        entityId: change.entityId,
        fromVersionId: change.fromVersionId,
        fromVersion: change.fromVersion,
        toVersionId: change.toVersionId,
        toVersion: change.toVersion,
        source: change.source,
        actorUserId: change.actorUserId,
        hubOperationId: change.hubOperationId,
        hubMessageId: change.hubMessageId,
        interpretedIntent: change.interpretedIntent,
        mutations: change.mutations as unknown as Prisma.InputJsonValue,
        rationale: change.rationale,
      },
    });
  }

  async create(context: TenantContext, input: CreateAgentInput): Promise<AgentWithVersion> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = attempt === 0 ? input.agent.slugBase : `${input.agent.slugBase}-${attempt + 1}`;

      try {
        return await withWriteConflictRetry(() => this.insert(context, input, slug));
      } catch (error) {
        if (isUniqueViolationOn(error, 'slug')) continue;
        throw error;
      }
    }

    throw new ConflictError('CONFLICT', 'Não foi possível gerar um identificador para o agente.');
  }

  private async insert(
    context: TenantContext,
    input: CreateAgentInput,
    slug: string,
  ): Promise<AgentWithVersion> {
    return this.db.$transaction(async (tx) => {
      const agent = await tx.agent.create({
        data: {
          id: input.agent.id,
          accountId: context.accountId,
          name: input.agent.name,
          slug,
          role: input.agent.role,
          createdBy: input.agent.createdBy,
          lockVersion: 1,
          currentVersionId: input.version.id,
          // Espelha o que já está no canônico. A coluna existe para a pergunta
          // do ADMIN — "quantos agentes vieram deste ofício?" — que é
          // cross-tenant e não tem como varrer JSON de versão corrente.
          ...(input.version.canonicalConfig.playbookKey
            ? { playbookKey: input.version.canonicalConfig.playbookKey }
            : {}),
        },
      });

      const version = await tx.agentVersion.create({
        data: {
          id: input.version.id,
          accountId: context.accountId,
          agentId: agent.id,
          versionNumber: 1,
          canonicalConfig: input.version.canonicalConfig as unknown as Prisma.InputJsonValue,
          canonicalSchemaVersion: input.version.canonicalConfig.canonicalSchemaVersion,
          humanSummary: input.version.humanSummary as unknown as Prisma.InputJsonValue,
          source: input.version.source,
          reason: input.version.reason,
          previousVersionId: null,
        },
      });

      // Versão, ponteiro, mudança e auditoria na MESMA transação (§4.1, §69).
      await this.writeChange(tx, context.accountId, {
        ...input.change,
        entityId: agent.id,
        fromVersionId: null,
        fromVersion: null,
        toVersionId: version.id,
        toVersion: 1,
      });

      await this.audit.write({ ...input.audit, entityId: agent.id }, tx);

      return { agent: toAgent(agent), version: toVersion(version) };
    });
  }

  async updateConfiguration(
    context: TenantContext,
    input: UpdateAgentInput,
  ): Promise<AgentWithVersion> {
    return withWriteConflictRetry(() =>
      this.db.$transaction(async (tx) => {
        const current = await tx.agent.findFirst({
          where: { id: input.agentId, accountId: context.accountId },
        });
        if (!current) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

        const versionNumber =
          (await tx.agentVersion.count({
            where: { agentId: input.agentId, accountId: context.accountId },
          })) + 1;

        const version = await tx.agentVersion.create({
          data: {
            id: input.version.id,
            accountId: context.accountId,
            agentId: input.agentId,
            versionNumber,
            canonicalConfig: input.version.canonicalConfig as unknown as Prisma.InputJsonValue,
            canonicalSchemaVersion: input.version.canonicalConfig.canonicalSchemaVersion,
            humanSummary: input.version.humanSummary as unknown as Prisma.InputJsonValue,
            source: input.version.source,
            reason: input.version.reason,
            previousVersionId: current.currentVersionId,
          },
        });

        // Lock otimista: sem ele o usuário B sobrescreve o A em silêncio (§70).
        const updated = await tx.agent.updateMany({
          where: {
            id: input.agentId,
            accountId: context.accountId,
            lockVersion: input.expectedLockVersion,
          },
          data: {
            currentVersionId: version.id,
            lockVersion: { increment: 1 },
            name: input.version.canonicalConfig.identity.name,
            role: input.version.canonicalConfig.identity.role,
          },
        });

        if (updated.count === 0) throw new ConcurrencyError('O agente');

        await this.writeChange(tx, context.accountId, {
          ...input.change,
          entityId: input.agentId,
          toVersionId: version.id,
          toVersion: versionNumber,
        });

        await this.audit.write(input.audit, tx);

        const agent = await tx.agent.findFirstOrThrow({
          where: { id: input.agentId, accountId: context.accountId },
        });

        return { agent: toAgent(agent), version: toVersion(version) };
      }),
    );
  }

  async findById(context: TenantContext, id: string): Promise<AgentWithVersion | null> {
    // findFirst com accountId — findUnique por id é o padrão que abre IDOR.
    const agent = await this.db.agent.findFirst({
      where: { id, accountId: context.accountId },
    });
    if (!agent) return null;

    const version = agent.currentVersionId
      ? await this.db.agentVersion.findFirst({
          where: { id: agent.currentVersionId, accountId: context.accountId },
        })
      : null;

    return { agent: toAgent(agent), version: version ? toVersion(version) : null };
  }

  async list(context: TenantContext, limit: number, cursor: string | null): Promise<AgentRecord[]> {
    const rows = await this.db.agent.findMany({
      where: { accountId: context.accountId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map(toAgent);
  }

  async listVersions(
    context: TenantContext,
    agentId: string,
    limit: number,
  ): Promise<AgentVersionRecord[]> {
    const rows = await this.db.agentVersion.findMany({
      where: { agentId, accountId: context.accountId },
      orderBy: { versionNumber: 'desc' },
      take: limit,
    });

    return rows.map(toVersion);
  }

  async delete(context: TenantContext, id: string): Promise<void> {
    // deleteMany com accountId: `delete` por id apagaria agente de outra conta.
    const removed = await this.db.agent.deleteMany({
      where: { id, accountId: context.accountId },
    });

    if (removed.count === 0) {
      throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');
    }
  }

  async findVersion(
    context: TenantContext,
    agentId: string,
    versionNumber: number,
  ): Promise<AgentVersionRecord | null> {
    const row = await this.db.agentVersion.findFirst({
      where: { agentId, accountId: context.accountId, versionNumber },
    });
    return row ? toVersion(row) : null;
  }
}
