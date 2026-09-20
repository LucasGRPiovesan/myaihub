import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['30d', 2_592_000],
    ['3600', 3600],
    ['1500ms', 1],
  ])('converte %s em %i segundos', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('aceita espaços em volta', () => {
    expect(parseDuration('  15m ')).toBe(900);
  });

  it.each(['', 'abc', '15x', '-5m', '1.5h'])('rejeita "%s"', (input) => {
    expect(() => parseDuration(input)).toThrow();
  });
});
