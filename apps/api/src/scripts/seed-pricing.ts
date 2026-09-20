import type { Db } from '../shared/infrastructure/prisma/client.js';
import { ulid } from 'ulid';

/**
 * Tabela de preços inicial (§38).
 *
 * Valores em MICROS de USD por 1.000.000 de tokens.
 * Ex.: US$ 0,10 por 1M de tokens = 100.000 micros.
 *
 * `effectiveFrom` no passado garante que qualquer chamada de hoje encontre um
 * preço vigente. Quando o preço mudar, insere-se uma NOVA linha com a data da
 * mudança — nunca se edita a existente, senão o custo histórico muda junto e
 * deixa de bater com o que foi faturado.
 *
 * Em desenvolvimento o Gemini Flash-Lite roda no tier gratuito; o custo
 * registrado aqui é informativo, e é exatamente o que queremos ver antes de
 * qualquer coisa ir para produção.
 */
const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00Z');

/**
 * ATENÇÃO — preços NÃO CONFIRMADOS.
 *
 * Os valores abaixo vieram da faixa conhecida da família Flash-Lite, não da
 * tabela oficial do gemini-3.5-flash-lite. Confirme em ai.google.dev/pricing
 * antes de tratar qualquer número de custo como verdade.
 *
 * O rótulo carrega isso de propósito: ele é gravado no `pricingSnapshot` de
 * toda chamada, então um custo calculado com preço não confirmado fica
 * identificável no histórico em vez de virar número silenciosamente errado.
 *
 * Quando confirmar: insira uma linha NOVA com a data de vigência e o rótulo
 * definitivo. Não edite esta — histórico não se reescreve (§38).
 */
const SOURCE_LABEL = 'estimado-flash-lite-PENDENTE-CONFIRMACAO';

interface PricingSeed {
  provider: 'GEMINI';
  model: string;
  inputMicros: bigint;
  cachedInputMicros: bigint;
  outputMicros: bigint;
}

const PRICES: PricingSeed[] = [
  {
    provider: 'GEMINI',
    model: 'gemini-3.5-flash-lite',
    inputMicros: 100_000n, // US$ 0,10 / 1M
    cachedInputMicros: 25_000n, // US$ 0,025 / 1M
    outputMicros: 400_000n, // US$ 0,40 / 1M
  },
  {
    provider: 'GEMINI',
    model: 'gemini-3.5-flash',
    inputMicros: 300_000n, // US$ 0,30 / 1M
    cachedInputMicros: 75_000n,
    outputMicros: 2_500_000n, // US$ 2,50 / 1M
  },
];

export async function seedPricing(prisma: Db, options: { quiet?: boolean } = {}): Promise<void> {
  for (const price of PRICES) {
    await prisma.aiModelPricing.upsert({
      where: {
        provider_model_effectiveFrom: {
          provider: price.provider,
          model: price.model,
          effectiveFrom: EFFECTIVE_FROM,
        },
      },
      update: {
        inputMicros: price.inputMicros,
        cachedInputMicros: price.cachedInputMicros,
        outputMicros: price.outputMicros,
        sourceLabel: SOURCE_LABEL,
      },
      create: {
        id: ulid(),
        provider: price.provider,
        model: price.model,
        inputMicros: price.inputMicros,
        cachedInputMicros: price.cachedInputMicros,
        cacheWriteMicros: 0n,
        outputMicros: price.outputMicros,
        reasoningMicros: 0n,
        currency: 'USD',
        effectiveFrom: EFFECTIVE_FROM,
        sourceLabel: SOURCE_LABEL,
      },
    });

    if (!options.quiet)
      console.log(
        `  ✓ preço  ${price.provider.toLowerCase()}/${price.model}  ` +
          `in ${Number(price.inputMicros) / 1e6} · out ${Number(price.outputMicros) / 1e6} USD/1M`,
      );
  }

  // O FakeProvider fica de fora de propósito: chamada de teste não tem custo,
  // e cadastrar preço para ele faria os números de teste parecerem gasto real.
}
