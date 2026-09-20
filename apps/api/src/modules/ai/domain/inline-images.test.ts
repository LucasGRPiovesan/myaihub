import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { PUBLIC_INLINE_IMAGE_LIMITS, validateInlineImages } from './inline-images.js';

const LIMITS = { maxImages: 2, maxBytes: 1024 };

function base64Of(bytes: number): string {
  return Buffer.alloc(bytes, 1).toString('base64');
}

describe('validação de imagens inline (agente)', () => {
  it('aceita dentro dos limites', () => {
    expect(() =>
      validateInlineImages([{ mimeType: 'image/png', data: base64Of(100) }], LIMITS),
    ).not.toThrow();
  });

  it('recusa formato fora da allowlist', () => {
    expect(() =>
      validateInlineImages([{ mimeType: 'image/svg+xml', data: base64Of(10) }], LIMITS),
    ).toThrow(ValidationError);
  });

  it('recusa acima do tamanho permitido, medindo o base64 decodificado', () => {
    expect(() =>
      validateInlineImages([{ mimeType: 'image/png', data: base64Of(2000) }], LIMITS),
    ).toThrow(ValidationError);
  });

  it('recusa mais imagens do que o permitido', () => {
    const tres = Array.from({ length: 3 }, () => ({
      mimeType: 'image/png' as const,
      data: base64Of(10),
    }));
    expect(() => validateInlineImages(tres, LIMITS)).toThrow(ValidationError);
  });

  it('chat público aceita só 1 imagem, mais apertado que o Lab', () => {
    expect(() =>
      validateInlineImages(
        [
          { mimeType: 'image/png', data: base64Of(10) },
          { mimeType: 'image/png', data: base64Of(10) },
        ],
        PUBLIC_INLINE_IMAGE_LIMITS,
      ),
    ).toThrow(ValidationError);
  });
});
