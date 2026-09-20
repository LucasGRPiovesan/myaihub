import type { ProviderKeyKind, ProviderName } from '@myaihub/shared';

export interface ProviderSettingRecord {
  provider: ProviderName;
  enabled: boolean;
}

export interface ProviderCredentialRecord {
  provider: ProviderName;
  kind: ProviderKeyKind;
  apiKeyCipher: string;
  updatedAt: Date;
}

/**
 * Onde vivem as chaves e o liga/desliga de cada provider — a PLATAFORMA
 * inteira, como `ModelRouteRepository`.
 */
export interface ProviderCredentialRepository {
  listSettings(): Promise<ProviderSettingRecord[]>;
  listCredentials(): Promise<ProviderCredentialRecord[]>;
  setEnabled(provider: ProviderName, enabled: boolean, actorUserId: string): Promise<void>;
  saveKey(
    provider: ProviderName,
    kind: ProviderKeyKind,
    apiKeyCipher: string,
    actorUserId: string | null,
  ): Promise<void>;
}

/**
 * Ports para o que a aplicação precisa de cifra, registro e teste — SEM
 * importar a implementação (invariante 2: application não conhece
 * infraestrutura). `CredentialCipher` (a classe real) e `ProviderRegistry` já
 * satisfazem estas formas estruturalmente; nenhum `implements` é necessário.
 */
export interface CredentialCipherPort {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

export interface ProviderRegistryPort {
  reload(provider: ProviderName): Promise<void>;
  /** A escolha do admin: usar a chave paga do Gemini mesmo com a gratuita de pé. */
  setGeminiForcedPaid(value: boolean): void;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export type TestProviderKey = (
  provider: ProviderName,
  apiKey: string,
) => Promise<ConnectionTestResult>;
