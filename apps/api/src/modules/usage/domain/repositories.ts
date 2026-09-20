import type { CalculatedCost, NormalizedUsage, ProviderName } from '@myaihub/shared';
import type { ExecutionTraceInput } from '../application/record-ai-call.use-case.js';
import type { PricingRecord } from './pricing.js';

export interface RecordedAiCall {
  id: string;
  accountId: string;
  role: string;
  provider: ProviderName;
  model: string;
  status: 'SUCCESS' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'INVALID_OUTPUT';
  usage: NormalizedUsage;
  cost: CalculatedCost;
  pricingVersionId: string | null;
  pricingSnapshot: Record<string, unknown> | null;
  errorCode: string | null;
  policyVersionId: string | null;
  policySections: string[] | null;
  trace: (ExecutionTraceInput & { id: string; provider: ProviderName; model: string }) | null;
}

export interface AiCallRepository {
  /** Grava a chamada e, quando houver, o trace — na MESMA transação. */
  record(call: RecordedAiCall): Promise<void>;
}

export interface AccountUsageSummary {
  totalCalls: number;
  totalTokens: number;
  totalCostMicros: number;
  byRole: Array<{ role: string; calls: number; totalTokens: number; costMicros: number }>;
}

export interface AiCallReadRepository {
  /** Tenant-scoped: exige accountId explícito. */
  summarizeForAccount(accountId: string, since: Date): Promise<AccountUsageSummary>;

  /**
   * Qual cota SERVIU a última chamada — e quando.
   *
   * O provider sabe qual chave ele usaria AGORA; isso é previsão, e previsão
   * reinicia junto do processo. Depois de um restart o adapter volta a supor
   * que a cota gratuita está de pé, e a tela dizia "cota gratuita" enquanto as
   * chamadas saíam pela paga — exatamente o tipo de número que este sistema
   * passou a sessão inteira corrigindo.
   *
   * Isto aqui é FATO: está gravado em `ai_calls`, veio do que aconteceu.
   * `null` quando ainda não houve chamada nenhuma.
   */
  lastServedTier(accountId: string): Promise<{ tier: 'FREE' | 'PAID'; at: Date } | null>;

  /**
   * A última cota servida em QUALQUER conta — para semear o boot.
   *
   * A cota é do PROJETO do Google, não de uma conta do MyAIHub: todas as
   * contas dividem a mesma chave, então a pergunta "a gratuita acabou?" não
   * tem recorte de tenant. Roda em contexto de SISTEMA, numa consulta estreita
   * por construção — uma linha, duas colunas.
   *
   * Sem isto, cada restart voltava a supor cota gratuita disponível: a Topbar
   * mentia até a primeira chamada e o seletor de modelo ficava travado sem
   * motivo.
   */
  lastServedTierAnywhere(): Promise<{ tier: 'FREE' | 'PAID'; at: Date } | null>;
}

export interface PricingRepository {
  /**
   * Preço vigente para provider/modelo em um instante.
   * Devolve null quando não há preço cadastrado — é o caso do FakeProvider.
   */
  findEffective(provider: ProviderName, model: string, at: Date): Promise<PricingRecord | null>;
}
