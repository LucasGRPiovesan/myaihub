import { useCallback, useState } from 'react';
import { isAcceptedImage } from '../hub/attachments';

/**
 * Imagem anexada a UM turno da conversa com o AGENTE (Lab e chat público).
 *
 * Diferente do `useAttachments` do Hub: não existe upload nem `MediaAsset`.
 * O arquivo vira base64 no PRÓPRIO cliente (`FileReader`), viaja dentro do
 * corpo da mensagem, e nunca é persistido — o servidor descarta os bytes
 * depois de usar a imagem naquele turno (ver `inline-images.ts` na API).
 */
export interface InlineImageAttachment {
  key: string;
  /** `blob:` local, só para o preview — nunca sai do navegador. */
  previewUrl: string;
  fileName: string;
  mimeType: string;
  /** Base64 puro, sem o prefixo `data:`. */
  data: string;
  status: 'ready' | 'failed';
  error?: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // `data:image/png;base64,AAAA...` — só o que vem depois da vírgula.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

export function useInlineImages(limits: { maxImages: number; maxBytes: number }) {
  const [items, setItems] = useState<InlineImageAttachment[]>([]);

  const add = useCallback(
    async (files: File[]) => {
      const accepted = files.filter((file) => isAcceptedImage(file.type));
      if (accepted.length === 0) return;

      setItems((current) => {
        const room = Math.max(0, limits.maxImages - current.length);
        const selected = accepted.slice(0, room);
        if (selected.length === 0) return current;

        // A conversão em base64 é assíncrona; entra como "ready" otimista e
        // corrige pra "failed" se a leitura falhar — não há upload que possa
        // travar em "carregando" para sempre.
        const entries: InlineImageAttachment[] = selected.map((file) => ({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          previewUrl: URL.createObjectURL(file),
          fileName: file.name || 'imagem',
          mimeType: file.type,
          data: '',
          status: file.size > limits.maxBytes ? 'failed' : 'ready',
          ...(file.size > limits.maxBytes
            ? { error: `Imagem acima de ${Math.floor(limits.maxBytes / (1024 * 1024))}MB.` }
            : {}),
        }));

        void Promise.all(
          entries.map(async (entry, index) => {
            if (entry.status === 'failed') return;
            const file = selected[index];
            if (!file) return;

            try {
              const data = await readAsBase64(file);
              setItems((current2) =>
                current2.map((item) => (item.key === entry.key ? { ...item, data } : item)),
              );
            } catch {
              setItems((current2) =>
                current2.map((item) =>
                  item.key === entry.key
                    ? { ...item, status: 'failed', error: 'Falha ao ler a imagem.' }
                    : item,
                ),
              );
            }
          }),
        );

        return [...current, ...entries];
      });
    },
    [limits.maxBytes, limits.maxImages],
  );

  const remove = useCallback((key: string) => {
    setItems((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((current) => {
      for (const item of current) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, []);

  /**
   * Esvazia o composer SEM revogar as preview URLs — quem chama assume a posse
   * delas (normalmente para exibir a miniatura no balão já enviado). Sem isto,
   * `clear()` apagaria o `blob:` no instante em que a imagem devia aparecer na
   * conversa: a imagem não é salva no servidor, então esse preview local é a
   * ÚNICA prova visual, nesta sessão, do que foi mandado.
   */
  const detach = useCallback((): InlineImageAttachment[] => {
    setItems([]);
    return items;
  }, [items]);

  const ready = items.filter((item) => item.status === 'ready' && item.data);

  return {
    items,
    add,
    remove,
    clear,
    detach,
    /** Pronto pro corpo da requisição. */
    payload: ready.map((item) => ({ mimeType: item.mimeType, data: item.data })),
    /** Ainda convertendo em base64 — impede enviar com anexo incompleto. */
    pending: items.some((item) => item.status === 'ready' && !item.data),
    full: items.length >= limits.maxImages,
  };
}
