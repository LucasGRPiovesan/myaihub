import { describe, expect, it } from 'vitest';
import { CredentialCipher, maskApiKey } from './credential-cipher.js';

describe('CredentialCipher', () => {
  const cipher = new CredentialCipher('um-segredo-de-teste-com-mais-de-32-caracteres');

  it('decifra exatamente o que cifrou', () => {
    const original = 'AIzaSyD-exemplo-de-chave-1234567890';
    const cifrado = cipher.encrypt(original);

    expect(cifrado).not.toBe(original);
    expect(cipher.decrypt(cifrado)).toBe(original);
  });

  it('duas cifras do mesmo texto são diferentes — IV aleatório por chamada', () => {
    const a = cipher.encrypt('mesma-chave');
    const b = cipher.encrypt('mesma-chave');

    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('mesma-chave');
    expect(cipher.decrypt(b)).toBe('mesma-chave');
  });

  it('segredo diferente não decifra — é o que faz o GCM valer a pena', () => {
    const outro = new CredentialCipher('outro-segredo-completamente-diferente-32ch');
    const cifrado = cipher.encrypt('valor-secreto');

    expect(() => outro.decrypt(cifrado)).toThrow();
  });
});

describe('maskApiKey', () => {
  it('mostra só os últimos 4 caracteres', () => {
    expect(maskApiKey('AIzaSyD1234567890')).toBe('••••••••7890');
  });
});
