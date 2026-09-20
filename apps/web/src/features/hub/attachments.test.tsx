import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAcceptedImage, useAttachments } from './attachments';

/**
 * O app roda em StrictMode, que invoca os updaters de estado DUAS vezes para
 * expor updater impuro. Testar fora dele esconderia exatamente a classe de bug
 * que travou o composer: uma fila de upload montada por efeito colateral
 * dentro do updater duplicava entradas e deixava itens presos em "uploading".
 */
function strict({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

function png(name = 'print.png', size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type: 'image/png' });
  // `File` no jsdom não respeita o tamanho do conteúdo em todos os casos.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function respondOk(id: string) {
  return {
    ok: true,
    status: 201,
    json: () =>
      Promise.resolve({
        id,
        url: `/api/media/${id}`,
        mimeType: 'image/png',
        fileName: 'print.png',
        width: 10,
        height: 10,
      }),
  } as Response;
}

beforeEach(() => {
  // O jsdom não implementa object URLs.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('anexos do composer', () => {
  it('SOBE o arquivo ao colar — o item não pode ficar preso em "uploading"', async () => {
    // Este teste existe por um bug real: a fila de upload era montada dentro do
    // updater do `setState`, que roda na RENDERIZAÇÃO. Na hora de enviar ela
    // ainda estava vazia, nenhum upload acontecia, e o botão Enviar travava
    // para sempre porque `uploading` nunca voltava a ser falso.
    const fetchMock = vi.fn().mockResolvedValue(respondOk('01ASSET'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/media');

    await waitFor(() => {
      expect(result.current.uploading).toBe(false);
    });

    expect(result.current.items[0]?.status).toBe('ready');
    expect(result.current.readyIds).toEqual(['01ASSET']);
  });

  it('marca como falho, e não trava, quando o servidor recusa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 415,
        json: () => Promise.resolve({ error: { message: 'Formato não aceito.' } }),
      } as Response),
    );

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    await waitFor(() => {
      expect(result.current.uploading).toBe(false);
    });

    expect(result.current.items[0]?.status).toBe('failed');
    expect(result.current.items[0]?.error).toBe('Formato não aceito.');
    // Um anexo falho não pode virar id enviado ao backend.
    expect(result.current.readyIds).toEqual([]);
  });

  it('recusa arquivo grande sem sequer chamar a rede', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    await act(async () => {
      await result.current.add([png('grande.png', 9 * 1024 * 1024)]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.items[0]?.status).toBe('failed');
    expect(result.current.uploading).toBe(false);
  });

  it('respeita o teto de anexos mesmo em colagens seguidas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondOk('01ASSET')));

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    // Duas colagens em sequência: o contador não pode reiniciar entre elas.
    await act(async () => {
      await result.current.add([png('a.png'), png('b.png'), png('c.png')]);
    });
    await act(async () => {
      await result.current.add([png('d.png'), png('e.png')]);
    });

    expect(result.current.items).toHaveLength(4);
    expect(result.current.full).toBe(true);
  });

  it('remover libera espaço e devolve o item', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondOk('01ASSET')));

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    const key = result.current.items[0]!.key;
    act(() => {
      result.current.remove(key);
    });

    expect(result.current.items).toHaveLength(0);
    // Sem revoke, cada print colado e removido vaza memória até o refresh.
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('o upload tem TETO — nenhum estado de carregamento espera promessa eterna', async () => {
    // Sem teto, um request pendurado deixa o item em "uploading" para sempre e
    // o botão Enviar nunca libera. Foi assim que o composer travou com o print
    // colado na tela.
    const fetchMock = vi.fn().mockResolvedValue(respondOk('01ASSET'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('o upload abortado vira falha, não item pendurado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError')),
    );

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.items[0]?.status).toBe('failed');
    // A mensagem diz o que fazer, não o nome da exceção.
    expect(result.current.items[0]?.error).toContain('Remova e tente de novo');
  });

  it('remover é a saída de emergência e não depende do upload terminar', async () => {
    let settle: (value: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(held));

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.add([png()]);
      // Deixa o estado "uploading" ser aplicado sem esperar o upload.
      await Promise.resolve();
    });

    expect(result.current.uploading).toBe(true);

    act(() => {
      result.current.remove(result.current.items[0]!.key);
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.items).toHaveLength(0);

    await act(async () => {
      settle(respondOk('01ASSET'));
      await pending;
    });
  });

  it('ignora o que não é imagem aceita', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAttachments(), { wrapper: strict });

    const pdf = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    await act(async () => {
      await result.current.add([pdf]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);
  });
});

describe('formatos aceitos no cliente', () => {
  it('espelha a allowlist do servidor', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isAcceptedImage(type), type).toBe(true);
    }
    // SVG é imagem que carrega script — recusado nas duas pontas.
    expect(isAcceptedImage('image/svg+xml')).toBe(false);
  });
});
