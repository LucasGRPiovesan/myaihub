import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import { LlmGateway } from '../src/modules/ai/application/llm-gateway.js';
import { ModelRouter } from '../src/modules/ai/application/model-router.js';
import type { ContextBlock } from '../src/modules/ai/domain/context.js';
import { FakeProvider } from '../src/modules/ai/infrastructure/providers/fake-provider.js';
import { RecordAiCallUseCase } from '../src/modules/usage/application/record-ai-call.use-case.js';
import {
  PrismaAiCallReadRepository,
  PrismaAiCallRepository,
  PrismaPricingRepository,
} from '../src/modules/usage/infrastructure/prisma-usage.repositories.js';
import type { TenantContext } from '../src/shared/application/tenant-context.js';
import { SystemClock, UlidGenerator } from '../src/shared/infrastructure/system-clock.js';
import { closeTestResources, getTestApp, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const ACCOUNT_ID = '01ACCOUNTAI00000000000001';
const OTHER_ACCOUNT_ID = '01ACCOUNTAI00000000000002';

function tenant(accountId = ACCOUNT_ID): TenantContext {
  return {
    accountId,
    userId: '01USERAI0000000000000001',
    role: 'USER',
    membershipRole: 'OWNER',
    elevated: false,
  };
}

function block(id: string, kind: ContextBlock['kind'], content: string): ContextBlock {
  return { id, kind, trust: 'TRUSTED', priority: 50, cacheable: kind === 'STABLE', content };
}

/**
 * Critério da Fase 3: chamada ponta a ponta com AiCall e ExecutionTrace
 * persistidos. Roda inteiramente contra o FakeProvider — nenhum teste consome
 * API paga (§10 dos ajustes).
 */
describe.skipIf(!enabled)('pipeline de IA (integração)', () => {
  // Garante o container montado (e portanto o env de teste resolvido).
  getTestApp();

  const provider = new FakeProvider();
  const db = rawDb as unknown as Parameters<typeof buildGateway>[0];

  function buildGateway(client: typeof rawDb) {
    const router = new ModelRouter(
      {
        'hub.reasoning': { provider: 'fake', model: 'fake-1' },
        'hub.fast': { provider: 'fake', model: 'fake-1' },
        'agent.runtime': { provider: 'fake', model: 'fake-1' },
        'validation.fast': { provider: 'fake', model: 'fake-1' },
        'analysis.vision': { provider: 'fake', model: 'fake-1' },
      },
      new Map([['fake', provider]]),
    );

    const record = new RecordAiCallUseCase(
      new PrismaAiCallRepository(client as never),
      new PrismaPricingRepository(client as never),
      new UlidGenerator(),
      new SystemClock(),
    );

    return new LlmGateway(router, record);
  }

  let gateway: LlmGateway;

  beforeEach(async () => {
    await resetDatabase();
    await rawDb.account.createMany({
      data: [
        { id: ACCOUNT_ID, name: 'Conta IA', slug: 'conta-ia' },
        { id: OTHER_ACCOUNT_ID, name: 'Outra Conta', slug: 'outra-conta-ia' },
      ],
    });
    provider.reset();
    gateway = buildGateway(rawDb);
  });

  afterAll(async () => {
    await closeTestResources();
  });

  it('persiste AiCall e ExecutionTrace numa chamada bem-sucedida', async () => {
    provider.script({ respond: 'a estratégia proposta é...' });

    const result = await gateway.generate(tenant(), {
      role: 'hub.reasoning',
      blocks: [block('policy', 'POLICY', 'regras do MyAIHub'), block('agent', 'STABLE', 'Philips')],
      messages: [{ role: 'user', content: 'proponha uma estratégia' }],
      params: { temperature: 0.4 },
    });

    expect(result.content).toBe('a estratégia proposta é...');

    const call = await rawDb.aiCall.findUniqueOrThrow({
      where: { id: result.aiCallId },
      include: { trace: true },
    });

    expect(call.accountId).toBe(ACCOUNT_ID);
    expect(call.role).toBe('hub.reasoning');
    expect(call.provider).toBe('FAKE');
    expect(call.status).toBe('SUCCESS');
    expect(call.totalTokens).toBeGreaterThan(0);

    // O trace precisa existir e descrever o request de verdade.
    expect(call.trace).not.toBeNull();
    expect(call.trace?.runtimeVersion).toBe('1.0.0');
    expect(call.trace?.generationParams).toMatchObject({ temperature: 0.4 });

    const compiled = call.trace?.compiledRequest as { systemInstruction: string };
    expect(compiled.systemInstruction).toContain('regras do MyAIHub');
  });

  it('registra a chamada mesmo quando o provider falha', async () => {
    // Uma chamada que falhou depois de consumir input ainda custou dinheiro, e
    // provider instável precisa aparecer nos números.
    provider.script({
      respond: '',
      fail: { code: 'PROVIDER_TIMEOUT', message: 'estourou o tempo' },
    });

    await expect(
      gateway.generate(tenant(), {
        role: 'hub.reasoning',
        blocks: [block('agent', 'STABLE', 'Philips')],
        messages: [{ role: 'user', content: 'olá' }],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });

    const calls = await rawDb.aiCall.findMany({ where: { accountId: ACCOUNT_ID } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe('TIMEOUT');
    expect(calls[0]?.errorCode).toBe('PROVIDER_TIMEOUT');
  });

  it('calcula custo e congela o snapshot de preço', async () => {
    await rawDb.aiModelPricing.create({
      data: {
        id: '01PRICINGTEST00000000001',
        provider: 'FAKE',
        model: 'fake-1',
        inputMicros: 100_000n,
        cachedInputMicros: 0n,
        cacheWriteMicros: 0n,
        outputMicros: 400_000n,
        reasoningMicros: 0n,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        sourceLabel: 'teste',
      },
    });

    provider.script({ respond: 'x'.repeat(4000) }); // ~1000 tokens de saída

    const result = await gateway.generate(tenant(), {
      role: 'hub.reasoning',
      blocks: [block('agent', 'STABLE', 'y'.repeat(4000))],
      messages: [{ role: 'user', content: 'olá' }],
    });

    const call = await rawDb.aiCall.findUniqueOrThrow({ where: { id: result.aiCallId } });

    expect(Number(call.costMicros)).toBeGreaterThan(0);
    expect(call.pricingVersionId).toBe('01PRICINGTEST00000000001');
    // Snapshot congelado: mesmo que a linha de preço mude depois, esta chamada
    // continua explicável (§38).
    expect(call.pricingSnapshot).toMatchObject({ sourceLabel: 'teste', outputMicros: '400000' });
  });

  it('não cobra quando não há preço cadastrado', async () => {
    provider.script({ respond: 'resposta' });

    const result = await gateway.generate(tenant(), {
      role: 'hub.fast',
      blocks: [],
      messages: [{ role: 'user', content: 'olá' }],
    });

    const call = await rawDb.aiCall.findUniqueOrThrow({ where: { id: result.aiCallId } });
    expect(Number(call.costMicros)).toBe(0);
    expect(call.pricingVersionId).toBeNull();
  });

  it('mantém saída estruturada validada e rastreada', async () => {
    const schema = z.object({ intencao: z.string(), confianca: z.number() });
    provider.script({ respond: JSON.stringify({ intencao: 'criar_campanha', confianca: 0.87 }) });

    const result = await gateway.generateStructured(
      tenant(),
      {
        role: 'hub.reasoning',
        blocks: [block('policy', 'POLICY', 'regras')],
        messages: [{ role: 'user', content: 'quero uma campanha' }],
      },
      schema,
    );

    expect(result.content).toEqual({ intencao: 'criar_campanha', confianca: 0.87 });
    await expect(
      rawDb.executionTrace.findFirst({ where: { aiCallId: result.aiCallId } }),
    ).resolves.not.toBeNull();
  });

  it('registra AiCall com INVALID_OUTPUT quando o JSON não bate com o schema', async () => {
    provider.script({ respond: JSON.stringify({ faltando: 'campos' }) });

    await expect(
      gateway.generateStructured(
        tenant(),
        { role: 'hub.reasoning', blocks: [], messages: [{ role: 'user', content: 'x' }] },
        z.object({ intencao: z.string() }),
      ),
    ).rejects.toMatchObject({ code: 'STRUCTURED_OUTPUT_INVALID' });

    const calls = await rawDb.aiCall.findMany({ where: { accountId: ACCOUNT_ID } });
    expect(calls[0]?.status).toBe('INVALID_OUTPUT');
  });

  it('persiste a chamada de streaming ao fim do stream', async () => {
    provider.script({ respond: 'texto transmitido em partes' });

    const chunks: string[] = [];
    let aiCallId: string | undefined;

    for await (const chunk of gateway.stream(tenant(), {
      role: 'agent.runtime',
      blocks: [block('agent', 'STABLE', 'Philips')],
      messages: [{ role: 'user', content: 'olá' }],
    })) {
      if (chunk.type === 'text') chunks.push(chunk.text);
      if (chunk.type === 'done') aiCallId = chunk.aiCallId;
    }

    expect(chunks.join('')).toBe('texto transmitido em partes');
    expect(aiCallId).toBeTruthy();

    const call = await rawDb.aiCall.findUniqueOrThrow({ where: { id: aiCallId! } });
    expect(call.role).toBe('agent.runtime');
  });

  it('escopa o uso por conta — o resumo de uma não enxerga a outra', async () => {
    provider.script({ respond: 'resposta' });

    await gateway.generate(tenant(ACCOUNT_ID), {
      role: 'hub.fast',
      blocks: [],
      messages: [{ role: 'user', content: 'a' }],
    });
    await gateway.generate(tenant(OTHER_ACCOUNT_ID), {
      role: 'hub.fast',
      blocks: [],
      messages: [{ role: 'user', content: 'b' }],
    });

    const read = new PrismaAiCallReadRepository(db as never);
    const summary = await read.summarizeForAccount(ACCOUNT_ID, new Date('2020-01-01'));

    expect(summary.totalCalls).toBe(1);
    expect(summary.byRole).toEqual([expect.objectContaining({ role: 'hub.fast', calls: 1 })]);
  });
});
