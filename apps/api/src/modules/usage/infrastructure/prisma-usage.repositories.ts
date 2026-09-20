import type { Prisma } from '@prisma/client';
import type { ProviderName } from '@myaihub/shared';
import {
  runWithTenantContext,
  systemTenantContext,
} from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import {
  PROVIDER_FROM_PRISMA as FROM_PRISMA,
  PROVIDER_TO_PRISMA as TO_PRISMA,
} from '../../../shared/infrastructure/prisma/provider-enum.js';
import type { PricingRecord } from '../domain/pricing.js';
import type {
  AccountUsageSummary,
  AiCallReadRepository,
  AiCallRepository,
  PricingRepository,
  RecordedAiCall,
} from '../domain/repositories.js';

export class PrismaPricingRepository implements PricingRepository {
  constructor(private readonly db: Db) {}

  async findEffective(
    provider: ProviderName,
    model: string,
    at: Date,
  ): Promise<PricingRecord | null> {
    // A linha vigente é a mais recente cujo effectiveFrom já passou. Preço
    // futuro fica cadastrado sem afetar chamadas de hoje.
    const row = await this.db.aiModelPricing.findFirst({
      where: { provider: TO_PRISMA[provider], model, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!row) return null;

    return {
      id: row.id,
      provider: FROM_PRISMA[row.provider],
      model: row.model,
      inputMicros: row.inputMicros,
      cachedInputMicros: row.cachedInputMicros,
      cacheWriteMicros: row.cacheWriteMicros,
      outputMicros: row.outputMicros,
      reasoningMicros: row.reasoningMicros,
      currency: 'USD',
      effectiveFrom: row.effectiveFrom,
      sourceLabel: row.sourceLabel,
    };
  }
}

export class PrismaAiCallRepository implements AiCallRepository {
  constructor(private readonly db: Db) {}

  async record(call: RecordedAiCall): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.aiCall.create({
        data: {
          id: call.id,
          accountId: call.accountId,
          role: call.role,
          provider: TO_PRISMA[call.provider],
          model: call.model,
          status: call.status,
          inputTokens: call.usage.inputTokens,
          cachedInputTokens: call.usage.cachedInputTokens,
          cacheWriteTokens: call.usage.cacheWriteTokens,
          outputTokens: call.usage.outputTokens,
          reasoningTokens: call.usage.reasoningTokens,
          toolCalls: call.usage.toolCalls,
          totalTokens: call.usage.totalTokens,
          latencyMs: call.usage.latencyMs,
          pricingVersionId: call.pricingVersionId,
          ...(call.pricingSnapshot
            ? { pricingSnapshot: call.pricingSnapshot as Prisma.InputJsonValue }
            : {}),
          costMicros: BigInt(call.cost.totalMicros),
          currency: call.cost.currency,
          policyVersionId: call.policyVersionId,
          ...(call.policySections
            ? { policySections: call.policySections as Prisma.InputJsonValue }
            : {}),
          errorCode: call.errorCode,
        },
      });

      if (!call.trace) return;

      // Trace e chamada na mesma transação: um trace órfão não é reproduzível,
      // e uma chamada sem trace não é auditável (§8.1).
      await tx.executionTrace.create({
        data: {
          id: call.trace.id,
          accountId: call.accountId,
          aiCallId: call.id,
          sessionId: call.trace.sessionId ?? null,
          hubOperationId: call.trace.hubOperationId ?? null,
          deploymentId: call.trace.deploymentId ?? null,
          deploymentManifestHash: call.trace.deploymentManifestHash ?? null,
          runtimeVersion: call.trace.runtimeVersion,
          contextCompilerVersion: call.trace.contextCompilerVersion,
          promptCompilerVersion: call.trace.promptCompilerVersion,
          provider: TO_PRISMA[call.trace.provider],
          model: call.trace.model,
          generationParams: call.trace.generationParams as Prisma.InputJsonValue,
          contextBlocks: call.trace.contextBlocks as Prisma.InputJsonValue,
          compiledRequest: call.trace.compiledRequest as Prisma.InputJsonValue,
          ...(call.trace.knowledgeRefs
            ? { knowledgeRefs: call.trace.knowledgeRefs as Prisma.InputJsonValue }
            : {}),
          ...(call.trace.violations
            ? { violations: call.trace.violations as Prisma.InputJsonValue }
            : {}),
        },
      });
    });
  }
}

export class PrismaAiCallReadRepository implements AiCallReadRepository {
  constructor(private readonly db: Db) {}

  async summarizeForAccount(accountId: string, since: Date): Promise<AccountUsageSummary> {
    const where = { accountId, createdAt: { gte: since } };

    const [totals, byRole] = await Promise.all([
      this.db.aiCall.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalTokens: true, costMicros: true },
      }),
      this.db.aiCall.groupBy({
        by: ['role'],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true, costMicros: true },
      }),
    ]);

    return {
      totalCalls: totals._count._all,
      totalTokens: totals._sum.totalTokens ?? 0,
      totalCostMicros: Number(totals._sum.costMicros ?? 0n),
      byRole: byRole.map((row) => ({
        role: row.role,
        calls: row._count._all,
        totalTokens: row._sum.totalTokens ?? 0,
        costMicros: Number(row._sum.costMicros ?? 0n),
      })),
    };
  }

  async lastServedTierAnywhere(): Promise<{ tier: 'FREE' | 'PAID'; at: Date } | null> {
    // Contexto de SISTEMA porque a pergunta não tem tenant: a cota é do
    // projeto do Google, e todas as contas dividem a mesma chave. O guard do
    // Prisma barra leitura sem accountId e está certo — a saída é declarar o
    // bootstrap, como o Public Chat faz para resolver publicId (§9).
    return runWithTenantContext(
      systemTenantContext('Boot: qual cota do provider serviu a última chamada.'),
      () => this.pickServedTier({}),
    );
  }

  async lastServedTier(accountId: string): Promise<{ tier: 'FREE' | 'PAID'; at: Date } | null> {
    return this.pickServedTier({ accountId });
  }

  private async pickServedTier(where: {
    accountId?: string;
  }): Promise<{ tier: 'FREE' | 'PAID'; at: Date } | null> {
    // A cota fica no snapshot de preço, junto do preço aplicado: é ele que
    // explica por que a chamada custou o que custou — inclusive quando custou
    // zero. Só chamadas SERVIDAS contam: uma que falhou antes de o provider
    // responder não diz de qual chave teria saído.
    // Algumas poucas, e não uma: a chamada mais recente pode ser de um provider
    // que não distingue cotas (o Fake, num ambiente misto) e não carregar a
    // marca. Ler um punhado acha a última que carrega, sem varrer a tabela.
    const linhas = await this.db.aiCall.findMany({
      where: { ...where, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { pricingSnapshot: true, createdAt: true },
    });

    for (const linha of linhas) {
      const tier = (linha.pricingSnapshot as { tier?: unknown } | null)?.tier;
      if (tier === 'FREE' || tier === 'PAID') return { tier, at: linha.createdAt };
    }

    return null;
  }
}
