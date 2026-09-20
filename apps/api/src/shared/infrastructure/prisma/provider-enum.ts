import type { AiProvider } from '@prisma/client';
import type { ProviderName } from '@myaihub/shared';

/**
 * `ProviderName` (minúsculo, o vocabulário do domínio) ↔ `AiProvider`
 * (maiúsculo, o enum do Prisma).
 *
 * Existia duplicado uma vez (`prisma-usage.repositories.ts`) e ganharia uma
 * segunda cópia com as credenciais de provider — a mesma classe de duplicação
 * que este projeto já paga caro em outros lugares. Um lugar só, os dois lados.
 */
export const PROVIDER_TO_PRISMA: Record<ProviderName, AiProvider> = {
  fake: 'FAKE',
  gemini: 'GEMINI',
  openai: 'OPENAI',
  anthropic: 'ANTHROPIC',
};

export const PROVIDER_FROM_PRISMA: Record<AiProvider, ProviderName> = {
  FAKE: 'fake',
  GEMINI: 'gemini',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
};
