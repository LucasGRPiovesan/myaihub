import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Cifra chaves de API de provider EM REPOUSO — AES-256-GCM.
 *
 * Nenhum segredo novo entra na `.env` por causa disto: a chave de cifra é
 * DERIVADA de `JWT_ACCESS_SECRET` (já existe, já tem 32+ caracteres, já é
 * secreta) por `scrypt`, com um sal fixo específico deste uso. Não é reduzir
 * segurança por reaproveitar um segredo — é um KDF padrão, e a alternativa
 * seria pedir uma variável nova só para isto, quebrando a promessa de que o
 * boot nunca exige configuração além do que já existe.
 *
 * A chave de cifra NUNCA é gravada — é recalculada a cada boot a partir do
 * segredo que já está na env. Perder `JWT_ACCESS_SECRET` também perde a
 * capacidade de decifrar as chaves salvas, o que é o comportamento certo: é o
 * mesmo segredo que já protege as sessões de todo mundo.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KDF_SALT = 'myaihub:ai-provider-credentials:v1';

export class CredentialCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = scryptSync(secret, KDF_SALT, 32);
  }

  /** `iv || tag || texto cifrado`, em base64 — um valor só, fácil de guardar numa coluna. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(payload: string): string {
    const buffer = Buffer.from(payload, 'base64');
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}

/** Os últimos 4 caracteres — o suficiente para o admin reconhecer QUAL chave é, sem expor o resto. */
export function maskApiKey(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `••••••••${tail}`;
}
