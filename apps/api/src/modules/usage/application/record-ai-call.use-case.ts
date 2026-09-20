import type { CalculatedCost, ModelRole, NormalizedUsage, ProviderName } from '@myaihub/shared';
import type { Clock, IdGenerator } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { calculateCost, ZERO_COST, type PricingRecord } from '../domain/pricing.js';
import type {
  AiCallRepository,
  PricingRepository,
  RecordedAiCall,
} from '../domain/repositories.js';

export type AiCallStatus = 'SUCCESS' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'INVALID_OUTPUT';

export interface ExecutionTraceInput {
  runtimeVersion: string;
  contextCompilerVersion: string;
  promptCompilerVersion: string;
  generationParams: Record<string, unknown>;
  /** ids, kind, trust, hash e tokens dos blocos — mais o que foi cortado. */
  contextBlocks: unknown;
  compiledRequest: unknown;
  /** Ids e pontuação dos trechos recuperados. Nunca o texto (§8.1). */
  knowledgeRefs?: unknown;
  sessionId?: string;
  hubOperationId?: string;
  deploymentId?: string;
  deploymentManifestHash?: string;
  violations?: unknown;
}

export interface RecordAiCallInput {
  role: ModelRole;
  provider: ProviderName;
  model: string;
  status: AiCallStatus;
  usage: NormalizedUsage;
  errorCode?: string;
  policyVersionId?: string;
  policySections?: string[];
  /** Cota que serviu a chamada. A gratuita não é cobrada. */
  tier?: 'FREE' | 'PAID';
  /** Quando presente, o trace é gravado na mesma transação da chamada. */
  trace?: ExecutionTraceInput;
}

export interface RecordAiCallResult {
  aiCallId: string;
  cost: CalculatedCost;
  pricing: PricingRecord | null;
}

/**
 * Persiste uso e custo de uma chamada de LLM (§37, §38).
 *
 * Roda para chamada bem-sucedida E para falha: uma chamada que estourou timeout
 * depois de consumir tokens de input ainda custou dinheiro, e um provider que
 * falha muito precisa aparecer nos números.
 */
export class RecordAiCallUseCase {
  constructor(
    private readonly calls: AiCallRepository,
    private readonly pricingRepository: PricingRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: TenantContext, input: RecordAiCallInput): Promise<RecordAiCallResult> {
    const now = this.clock.now();

    const pricing = await this.pricingRepository.findEffective(input.provider, input.model, now);

    /**
     * A COTA GRATUITA não custa — e o número na tela precisa ser verdade.
     *
     * O mesmo modelo, no mesmo pedido, custa dinheiro por uma chave e zero pela
     * outra: o preço de tabela é do provider, não da chave. Cobrar o turno
     * gratuito pelo preço de tabela inventaria uma despesa que não existe,
     * justo no número que o painel exibe como "quanto você está gastando".
     *
     * O `pricingSnapshot` continua sendo gravado: é ele que responde depois
     * quanto ESTE turno teria custado se tivesse saído pela chave paga.
     */
    const cost = pricing && input.tier !== 'FREE' ? calculateCost(input.usage, pricing) : ZERO_COST;

    const record: RecordedAiCall = {
      id: this.ids.generate(),
      accountId: context.accountId,
      role: input.role,
      provider: input.provider,
      model: input.model,
      status: input.status,
      usage: input.usage,
      cost,
      // Snapshot do preço aplicado: se a linha de preço mudar ou for removida,
      // esta chamada continua explicável (§38).
      pricingVersionId: pricing?.id ?? null,
      // A COTA entra no snapshot junto do preço: sem ela, uma chamada gravada
      // com custo zero e uma linha de preço válida ao lado seria indistinguível
      // de um erro de cálculo. Com ela, o zero se explica sozinho.
      pricingSnapshot: pricing
        ? { ...serializePricing(pricing), tier: input.tier ?? 'UNKNOWN' }
        : null,
      errorCode: input.errorCode ?? null,
      policyVersionId: input.policyVersionId ?? null,
      policySections: input.policySections ?? null,
      trace: input.trace
        ? { id: this.ids.generate(), provider: input.provider, model: input.model, ...input.trace }
        : null,
    };

    await this.calls.record(record);

    return { aiCallId: record.id, cost, pricing };
  }
}

/** BigInt não é serializável em JSON; o snapshot guarda string. */
function serializePricing(pricing: PricingRecord): Record<string, unknown> {
  return {
    id: pricing.id,
    provider: pricing.provider,
    model: pricing.model,
    inputMicros: pricing.inputMicros.toString(),
    cachedInputMicros: pricing.cachedInputMicros.toString(),
    cacheWriteMicros: pricing.cacheWriteMicros.toString(),
    outputMicros: pricing.outputMicros.toString(),
    reasoningMicros: pricing.reasoningMicros.toString(),
    currency: pricing.currency,
    effectiveFrom: pricing.effectiveFrom.toISOString(),
    sourceLabel: pricing.sourceLabel,
  };
}
