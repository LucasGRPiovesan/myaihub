import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fitsGeminiSchemaLimits, schemaComplexity, toGeminiSchema } from './gemini-schema.js';

describe('toGeminiSchema', () => {
  it('preserva os nomes das propriedades', () => {
    // Regressão: uma versão anterior filtrava as CHAVES de `properties` pela
    // allowlist de palavras-chave, apagando quase todo o schema.
    const adapted = toGeminiSchema({
      type: 'object',
      properties: { interpretedIntent: { type: 'string' }, rationale: { type: 'string' } },
      required: ['interpretedIntent'],
    }) as { properties: Record<string, unknown>; required: string[] };

    expect(Object.keys(adapted.properties)).toEqual(['interpretedIntent', 'rationale']);
    expect(adapted.required).toEqual(['interpretedIntent']);
  });

  it('remove palavras-chave que o Gemini não entende', () => {
    const adapted = toGeminiSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        a: { type: 'string', pattern: '^x', minLength: 2, maxLength: 8, default: 'x' },
      },
    }) as { properties: { a: Record<string, unknown> } };

    expect(adapted).not.toHaveProperty('$schema');
    expect(adapted).not.toHaveProperty('additionalProperties');
    expect(adapted.properties.a).toEqual({ type: 'string' });
  });

  it('traduz const para enum de valor único', () => {
    const adapted = toGeminiSchema({ const: 'UPSERT_AUDIENCE' }) as Record<string, unknown>;
    expect(adapted).toEqual({ enum: ['UPSERT_AUDIENCE'], type: 'string' });
  });

  it('traduz oneOf para anyOf', () => {
    const adapted = toGeminiSchema({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    }) as Record<string, unknown>;

    expect(adapted).toHaveProperty('anyOf');
    expect(adapted).not.toHaveProperty('oneOf');
  });

  it('mantém anyOf pequeno, que o Gemini suporta e induz melhor', () => {
    const adapted = toGeminiSchema({
      anyOf: [
        { type: 'object', properties: { kind: { const: 'A' } } },
        { type: 'object', properties: { kind: { const: 'B' } } },
      ],
    }) as { anyOf?: unknown[] };

    expect(adapted.anyOf).toHaveLength(2);
  });

  describe('achatamento de união grande', () => {
    const members = ['A', 'B', 'C', 'D', 'E'].map((kind, index) => ({
      type: 'object',
      properties: {
        kind: { const: kind },
        [`campo${index}`]: { type: 'string' },
      },
      required: ['kind', `campo${index}`],
    }));

    it('achata quando há membros demais', () => {
      const adapted = toGeminiSchema({ anyOf: members }) as {
        type: string;
        properties: Record<string, unknown>;
      };

      expect(adapted.type).toBe('object');
      expect(adapted).not.toHaveProperty('anyOf');
    });

    it('une os valores do discriminador num único enum', () => {
      const adapted = toGeminiSchema({ anyOf: members }) as {
        properties: { kind: { enum: string[] } };
      };

      // Sem a união, só o primeiro `kind` sobreviveria e o modelo nunca saberia
      // que os outros existem.
      expect(adapted.properties.kind.enum).toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    it('exige apenas o que TODO membro exige', () => {
      const adapted = toGeminiSchema({ anyOf: members }) as { required: string[] };
      expect(adapted.required).toEqual(['kind']);
    });

    it('documenta quais campos pertencem a cada kind', () => {
      // Compensa a perda de indução: o modelo recebe a mesma informação que o
      // schema achatado não consegue mais expressar.
      const adapted = toGeminiSchema({ anyOf: members }) as { description: string };

      expect(adapted.description).toContain('A: campo0');
      expect(adapted.description).toContain('E: campo4');
    });
  });

  it('degrada objeto sem propriedades para string', () => {
    // `z.record()` vira um objeto sem `properties`, que o Gemini rejeita.
    const adapted = toGeminiSchema({ type: 'object', additionalProperties: true });
    expect(adapted).toEqual({ type: 'string' });
  });
});

describe('limites de complexidade', () => {
  it('conta propriedades recursivamente', () => {
    const complexity = schemaComplexity({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'object', properties: { c: { type: 'string' }, d: { type: 'string' } } },
      },
    });

    expect(complexity).toBe(4);
  });

  it('aprova schema simples', () => {
    const simple = toGeminiSchema(
      z.toJSONSchema(z.object({ intent: z.string(), confidence: z.number() }), { io: 'output' }),
    );
    expect(fitsGeminiSchemaLimits(simple)).toBe(true);
  });

  it('reprova schema complexo — é o gatilho da degradação para JSON mode', () => {
    const complex = z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
      d: z.string(),
      e: z.string(),
      f: z.string(),
      g: z.string(),
      h: z.string(),
      i: z.string(),
      j: z.string(),
      k: z.string(),
      l: z.string(),
    });

    expect(fitsGeminiSchemaLimits(toGeminiSchema(z.toJSONSchema(complex, { io: 'output' })))).toBe(
      false,
    );
  });
});
