import { describe, expect, it } from 'vitest';
import { isAcceptedImage, readImageSize } from './media.js';

/** PNG mínimo: assinatura + IHDR com as dimensões pedidas. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(32);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(16);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt16BE(0xffd8, 0);
  bytes.writeUInt8(0xff, 2);
  bytes.writeUInt8(0xc0, 3); // SOF0
  bytes.writeUInt16BE(17, 4); // tamanho do segmento
  bytes.writeUInt8(8, 6); // precisão
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

describe('formatos aceitos', () => {
  it('aceita os formatos raster que o painel envia', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isAcceptedImage(type), type).toBe(true);
    }
  });

  it('recusa SVG — é imagem que carrega script', () => {
    expect(isAcceptedImage('image/svg+xml')).toBe(false);
  });

  it('recusa qualquer outra coisa', () => {
    for (const type of ['application/pdf', 'text/html', 'application/octet-stream', '']) {
      expect(isAcceptedImage(type), type).toBe(false);
    }
  });
});

describe('dimensões lidas do cabeçalho', () => {
  it('lê PNG', () => {
    expect(readImageSize(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it('lê GIF', () => {
    expect(readImageSize(gif(320, 200))).toEqual({ width: 320, height: 200 });
  });

  it('lê JPEG', () => {
    expect(readImageSize(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('recusa arquivo que se diz imagem e não é', () => {
    // O `Content-Type` do cliente pode mentir; o cabeçalho não.
    const disfarcado = Buffer.from('<script>alert(1)</script>', 'utf8');
    expect(readImageSize(disfarcado)).toBeNull();
  });

  it('não estoura com arquivo truncado', () => {
    expect(readImageSize(Buffer.alloc(0))).toBeNull();
    expect(readImageSize(Buffer.from('89504e470d0a1a0a', 'hex'))).toBeNull();
  });
});
