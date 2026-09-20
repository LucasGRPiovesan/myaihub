import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../application/ports.js';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Hash de senha com scrypt (memory-hard), da biblioteca padrão do Node.
 *
 * Escolha deliberada sobre argon2/bcrypt nativos: zero dependência com etapa de
 * compilação nativa, o que remove uma classe inteira de dor de instalação
 * (especialmente em Windows) e de superfície de supply chain. scrypt é
 * recomendado pelo OWASP para armazenamento de senha.
 *
 * Se um dia quisermos argon2id, basta outra implementação deste port — o
 * formato abaixo já carrega os parâmetros, então hashes antigos continuam
 * verificáveis e `needsRehash` sinaliza a regravação.
 *
 * Formato: `scrypt$N$r$p$<salt-b64url>$<hash-b64url>`
 */
const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// N=2^15 (32768), r=8, p=1 → ~32MB por hash. Acima do mínimo do OWASP (2^14).
const CURRENT_PARAMS = { N: 32768, r: 8, p: 1 } as const;
const MAXMEM = 128 * CURRENT_PARAMS.N * CURRENT_PARAMS.r * 2;

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parse(encoded: string): ParsedHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N <= 1 || (N & (N - 1)) !== 0) return null; // N precisa ser potência de 2
  if (!rawSalt || !rawKey) return null;

  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(rawSalt, 'base64url'),
      key: Buffer.from(rawKey, 'base64url'),
    };
  } catch {
    return null;
  }
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scryptAsync(plainText.normalize('NFKC'), salt, KEY_LENGTH, {
      ...CURRENT_PARAMS,
      maxmem: MAXMEM,
    });

    return [
      PREFIX,
      CURRENT_PARAMS.N,
      CURRENT_PARAMS.r,
      CURRENT_PARAMS.p,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  }

  async verify(plainText: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    // Hash malformado é falha de verificação, não exceção: um registro corrompido
    // não deve derrubar o login nem revelar nada pelo tipo do erro.
    if (!parsed) return false;

    try {
      const candidate = await scryptAsync(
        plainText.normalize('NFKC'),
        parsed.salt,
        parsed.key.length,
        {
          N: parsed.N,
          r: parsed.r,
          p: parsed.p,
          maxmem: 128 * parsed.N * parsed.r * 2,
        },
      );
      return timingSafeEqual(candidate, parsed.key);
    } catch {
      return false;
    }
  }

  needsRehash(encoded: string): boolean {
    const parsed = parse(encoded);
    if (!parsed) return true;
    return (
      parsed.N !== CURRENT_PARAMS.N ||
      parsed.r !== CURRENT_PARAMS.r ||
      parsed.p !== CURRENT_PARAMS.p ||
      parsed.key.length !== KEY_LENGTH
    );
  }
}
