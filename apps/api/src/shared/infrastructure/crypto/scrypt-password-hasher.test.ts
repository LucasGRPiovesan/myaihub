import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from './scrypt-password-hasher.js';

const hasher = new ScryptPasswordHasher();

describe('ScryptPasswordHasher', () => {
  it('verifica a senha correta', async () => {
    const hash = await hasher.hash('Senha@Muito#Forte1');
    await expect(hasher.verify('Senha@Muito#Forte1', hash)).resolves.toBe(true);
  });

  it('rejeita a senha errada', async () => {
    const hash = await hasher.hash('Senha@Muito#Forte1');
    await expect(hasher.verify('Senha@Muito#Forte2', hash)).resolves.toBe(false);
  });

  it('produz hashes diferentes para a mesma senha (salt aleatório)', async () => {
    const [a, b] = await Promise.all([hasher.hash('mesma-senha'), hasher.hash('mesma-senha')]);
    expect(a).not.toBe(b);
  });

  it('normaliza Unicode para que a mesma senha digitada em NFC ou NFD funcione', async () => {
    const nfc = 'senhação';
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);

    const hash = await hasher.hash(nfc);
    await expect(hasher.verify(nfd, hash)).resolves.toBe(true);
  });

  it('trata hash malformado como falha de verificação, não como exceção', async () => {
    for (const malformed of ['', 'nao-e-um-hash', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e']) {
      await expect(hasher.verify('qualquer', malformed)).resolves.toBe(false);
    }
  });

  it('não pede rehash para hashes gerados com os parâmetros atuais', async () => {
    const hash = await hasher.hash('senha-atual');
    expect(hasher.needsRehash(hash)).toBe(false);
  });

  it('pede rehash para parâmetros antigos ou hash inválido', () => {
    expect(hasher.needsRehash('scrypt$16384$8$1$c2FsdA$a2V5')).toBe(true);
    expect(hasher.needsRehash('lixo')).toBe(true);
  });
});
