import type { TenantContext } from '../../../shared/application/tenant-context.js';

/**
 * Arquivo enviado pelo usuário (invariante 4: upload é `MediaAsset`).
 *
 * Hoje só imagem, porque o único caminho de entrada é colar um print no painel.
 * O tipo permanece aberto para não precisar refazer a modelagem quando entrar
 * PDF de catálogo no Knowledge.
 */
export interface MediaAssetRecord {
  id: string;
  accountId: string;
  mimeType: string;
  byteSize: number;
  fileName: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

export interface CreateMediaAssetInput {
  id: string;
  mimeType: string;
  byteSize: number;
  fileName: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  uploadedBy: string;
}

export interface MediaRepository {
  create(context: TenantContext, input: CreateMediaAssetInput): Promise<MediaAssetRecord>;
  findById(context: TenantContext, id: string): Promise<MediaAssetRecord | null>;
  /** Carrega vários de uma vez — o painel manda um lote de anexos. */
  findManyByIds(context: TenantContext, ids: string[]): Promise<MediaAssetRecord[]>;
}

/**
 * Onde os BYTES ficam.
 *
 * Port porque o disco local resolve o desenvolvimento e não resolve produção.
 * A `storageKey` é opaca para o domínio: quem a interpreta é a implementação.
 */
export interface MediaStorage {
  /** Devolve a chave sob a qual o conteúdo foi gravado. */
  put(accountId: string, assetId: string, mimeType: string, bytes: Buffer): Promise<string>;
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}

/**
 * Tipos aceitos.
 *
 * Allowlist, nunca denylist: o navegador manda o `Content-Type` e um SVG
 * passaria por "imagem" carregando script. Aqui só entra raster.
 */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function isAcceptedImage(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Dimensões lidas do cabeçalho do próprio arquivo.
 *
 * Confiar no que o cliente informa deixaria a UI reservar o espaço errado — e,
 * pior, aceitaria um arquivo que se diz PNG sem ser. Ler o cabeçalho valida as
 * duas coisas de uma vez, sem trazer uma biblioteca de imagem para o bundle.
 */
export function readImageSize(bytes: Buffer): { width: number; height: number } | null {
  // PNG: assinatura de 8 bytes, depois IHDR com largura e altura em big-endian.
  if (bytes.length > 24 && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // GIF: "GIF87a"/"GIF89a", dimensões em little-endian logo em seguida.
  if (bytes.length > 10 && bytes.toString('ascii', 0, 3) === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }

  // WebP: RIFF....WEBPVP8 — só o formato "lossy simples" tem tamanho fixo aqui.
  if (
    bytes.length > 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8 ') {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (format === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  // JPEG: percorre os marcadores até um SOF, que carrega as dimensões.
  if (bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);

      // SOF0..SOF15, exceto os marcadores que não descrevem quadro.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }

  return null;
}
