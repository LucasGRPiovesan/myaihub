import { useCallback, useRef, useState } from 'react';
import { ApiError, refreshSession } from '../../lib/api-client';

export interface UploadedAttachment {
  id: string;
  url: string;
  mimeType: string;
  fileName: string;
  width: number | null;
  height: number | null;
}

/** Anexo enquanto sobe: já aparece na tela, ainda sem id do servidor. */
export interface PendingAttachment {
  /** Chave local — o id do servidor só existe quando o upload termina. */
  key: string;
  /** `blob:` da imagem local, para o preview aparecer instantaneamente. */
  previewUrl: string;
  fileName: string;
  status: 'uploading' | 'ready' | 'failed';
  uploaded?: UploadedAttachment;
  error?: string;
}

export const MAX_ATTACHMENTS = 4;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Teto para o upload.
 *
 * Sem ele, um request pendurado deixa o item em "uploading" PARA SEMPRE — e
 * como o botão Enviar espera os anexos, o composer inteiro trava sem explicação.
 * Nenhum estado de carregamento pode depender de uma promessa que talvez nunca
 * se resolva.
 */
const UPLOAD_TIMEOUT_MS = 30_000;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function isAcceptedImage(type: string): boolean {
  return ACCEPTED.includes(type);
}

/**
 * Anexos do composer.
 *
 * O upload começa no momento de colar, não no envio: o preview aparece na hora
 * e a espera acontece enquanto a pessoa termina de escrever, em vez de somar ao
 * tempo do envio. Se o upload falhar, ela descobre antes de mandar.
 */
export function useAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([]);

  // O updater de `setItems` roda na RENDERIZAÇÃO, não na chamada. Montar a
  // fila de upload lá dentro deixava esta lista vazia no momento do envio: o
  // upload nunca começava, o item ficava eternamente em "uploading" e o botão
  // Enviar travava. A fila é decidida AQUI, de forma síncrona.
  const count = useRef(0);
  count.current = items.length;

  const add = useCallback(async (files: File[]) => {
    const accepted = files.filter((file) => isAcceptedImage(file.type));
    if (accepted.length === 0) return;

    const room = Math.max(0, MAX_ATTACHMENTS - count.current);
    const selected = accepted.slice(0, room);
    if (selected.length === 0) return;

    const entries: PendingAttachment[] = selected.map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      previewUrl: URL.createObjectURL(file),
      fileName: file.name || 'imagem',
      status: file.size > MAX_BYTES ? 'failed' : 'uploading',
      ...(file.size > MAX_BYTES ? { error: 'Imagem acima de 8 MB.' } : {}),
    }));

    count.current += entries.length;
    setItems((current) => [...current, ...entries]);

    await Promise.all(
      entries.map(async (entry, index) => {
        if (entry.status === 'failed') return;

        const file = selected[index];
        if (!file) return;

        try {
          const body = new FormData();
          body.append('file', file, entry.fileName);

          // `fetch` direto, sem o apiRequest: ele serializa JSON, e multipart
          // precisa que o browser monte o boundary sozinho. O preço é ter de
          // repetir aqui a renovação de sessão que o apiRequest faz sozinho.
          const send = () =>
            fetch('/api/media', {
              method: 'POST',
              credentials: 'include',
              body,
              signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
            });

          let response = await send();
          if (response.status === 401 && (await refreshSession())) {
            response = await send();
          }

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            throw new ApiError(
              'VALIDATION_ERROR',
              payload?.error?.message ?? 'Não foi possível enviar a imagem.',
              response.status,
              '',
            );
          }

          const uploaded = (await response.json()) as UploadedAttachment;

          setItems((current) =>
            current.map((item) =>
              item.key === entry.key ? { ...item, status: 'ready', uploaded } : item,
            ),
          );
        } catch (caught) {
          setItems((current) =>
            current.map((item) =>
              item.key === entry.key
                ? {
                    ...item,
                    status: 'failed',
                    error: uploadErrorMessage(caught),
                  }
                : item,
            ),
          );
        }
      }),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => {
      const target = current.find((item) => item.key === key);
      // Sem revoke, cada print colado e removido vaza memória até o refresh.
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = current.filter((item) => item.key !== key);
      count.current = next.length;
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    count.current = 0;
    setItems((current) => {
      for (const item of current) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, []);

  const readyIds = items
    .filter((item) => item.status === 'ready' && item.uploaded)
    .map((item) => item.uploaded!.id);

  return {
    items,
    add,
    remove,
    clear,
    readyIds,
    /** Enviar no meio do upload mandaria a fala sem a imagem que a explica. */
    uploading: items.some((item) => item.status === 'uploading'),
    full: items.length >= MAX_ATTACHMENTS,
  };
}

/** Mensagem que diz o que fazer, não o nome técnico da exceção. */
function uploadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'demorou demais para subir. Remova e tente de novo.';
  }
  if (error instanceof Error) return error.message;
  return 'falha no envio.';
}

/** Arquivos de imagem de um evento de colar. */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isAcceptedImage(file.type)) files.push(file);
  }
  return files;
}
