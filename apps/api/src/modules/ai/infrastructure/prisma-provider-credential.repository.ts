import { PROVIDER_KEY_KINDS, type ProviderKeyKind, type ProviderName } from '@myaihub/shared';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import {
  PROVIDER_FROM_PRISMA,
  PROVIDER_TO_PRISMA,
} from '../../../shared/infrastructure/prisma/provider-enum.js';
import type {
  ProviderCredentialRecord,
  ProviderCredentialRepository,
  ProviderSettingRecord,
} from '../application/provider-credentials.js';

/**
 * As chaves e o liga/desliga de cada provider, no banco.
 *
 * UNSCOPED, como `ModelRoute`. Linha com `kind` que o código não conhece mais
 * é ignorada na leitura pelo mesmo motivo de sempre: um deploy que remove um
 * tipo de chave não pode impedir o sistema de subir por causa de uma linha
 * órfã.
 */
export class PrismaProviderCredentialRepository implements ProviderCredentialRepository {
  constructor(private readonly db: Db) {}

  async listSettings(): Promise<ProviderSettingRecord[]> {
    const linhas = await this.db.aiProviderSetting.findMany();
    return linhas.map((linha) => ({
      provider: PROVIDER_FROM_PRISMA[linha.provider],
      enabled: linha.enabled,
    }));
  }

  async listCredentials(): Promise<ProviderCredentialRecord[]> {
    const linhas = await this.db.aiProviderCredential.findMany();
    return linhas.flatMap((linha) => {
      if (!(PROVIDER_KEY_KINDS as readonly string[]).includes(linha.kind)) return [];
      return [
        {
          provider: PROVIDER_FROM_PRISMA[linha.provider],
          kind: linha.kind as ProviderKeyKind,
          apiKeyCipher: linha.apiKeyCipher,
          updatedAt: linha.updatedAt,
        },
      ];
    });
  }

  async setEnabled(provider: ProviderName, enabled: boolean, actorUserId: string): Promise<void> {
    const alvo = PROVIDER_TO_PRISMA[provider];
    await this.db.aiProviderSetting.upsert({
      where: { provider: alvo },
      create: { provider: alvo, enabled, updatedBy: actorUserId },
      update: { enabled, updatedBy: actorUserId },
    });
  }

  async saveKey(
    provider: ProviderName,
    kind: ProviderKeyKind,
    apiKeyCipher: string,
    actorUserId: string | null,
  ): Promise<void> {
    const alvo = PROVIDER_TO_PRISMA[provider];
    await this.db.aiProviderCredential.upsert({
      where: { provider_kind: { provider: alvo, kind } },
      create: { provider: alvo, kind, apiKeyCipher, updatedBy: actorUserId },
      update: { apiKeyCipher, updatedBy: actorUserId },
    });
  }
}
