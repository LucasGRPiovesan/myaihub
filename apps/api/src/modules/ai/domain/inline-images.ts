import { ValidationError } from '../../../shared/domain/errors.js';
import { isAcceptedImage } from '../../media/domain/media.js';

/**
 * Imagem que o cliente anexou a UM turno da conversa com o AGENTE.
 *
 * Diferente do `MediaAsset` do painel do S.O: aqui não existe upload nem
 * armazenamento. A imagem chega em base64 dentro do corpo da mensagem, vira
 * `LlmImagePart` para ESTE turno, e é descartada — nada grava os bytes. O que
 * fica no histórico da conversa é só o texto (ver `ConversationService`).
 */
export interface InlineImage {
  mimeType: string;
  /** Base64 puro, sem o prefixo `data:`. */
  data: string;
}

export interface InlineImageLimits {
  maxImages: number;
  maxBytes: number;
}

/**
 * Lab (autenticado, só quem já tem conta) — mais folga.
 */
export const LAB_INLINE_IMAGE_LIMITS: InlineImageLimits = {
  maxImages: 3,
  maxBytes: 6 * 1024 * 1024,
};

/**
 * Chat público (anônimo) — é a ÚNICA rota do sistema em que um estranho já
 * aciona chamada paga ao provider. Mais apertado de propósito: controla custo
 * e abuso onde o risco é real, não onde é conveniente.
 */
export const PUBLIC_INLINE_IMAGE_LIMITS: InlineImageLimits = {
  maxImages: 1,
  maxBytes: 5 * 1024 * 1024,
};

/**
 * Valida ANTES de virar `LlmImagePart` — nunca confiar no `mimeType`
 * declarado sozinho nem no tamanho do payload sem medir o base64 decodificado.
 */
export function validateInlineImages(images: InlineImage[], limits: InlineImageLimits): void {
  if (images.length > limits.maxImages) {
    throw new ValidationError(
      limits.maxImages === 1
        ? 'No máximo 1 imagem por mensagem.'
        : `No máximo ${limits.maxImages} imagens por mensagem.`,
    );
  }

  for (const image of images) {
    if (!isAcceptedImage(image.mimeType)) {
      throw new ValidationError('Formato de imagem não suportado.');
    }

    const bytes = Buffer.byteLength(image.data, 'base64');
    if (bytes > limits.maxBytes) {
      throw new ValidationError(
        `Imagem acima do limite de ${Math.floor(limits.maxBytes / (1024 * 1024))}MB.`,
      );
    }
  }
}
