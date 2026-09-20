import { describe, expect, it } from 'vitest';
import { defaultAccountName, slugify } from './types.js';

describe('slugify', () => {
  it.each([
    ['Easy', 'easy'],
    ['Conta da Ação', 'conta-da-acao'],
    ['  Espaços   Extras  ', 'espacos-extras'],
    ['Símbolos !@#$ aqui', 'simbolos-aqui'],
    ['MAIÚSCULAS', 'maiusculas'],
  ])('converte "%s" em "%s"', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('nunca devolve slug vazio', () => {
    expect(slugify('!!!')).toBe('conta');
    expect(slugify('')).toBe('conta');
  });

  it('limita o tamanho', () => {
    expect(slugify('a'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe('defaultAccountName', () => {
  it('usa o primeiro nome', () => {
    expect(defaultAccountName('Lucas Piovesan')).toBe('Conta de Lucas');
  });

  it('lida com nome único', () => {
    expect(defaultAccountName('Lucas')).toBe('Conta de Lucas');
  });
});
