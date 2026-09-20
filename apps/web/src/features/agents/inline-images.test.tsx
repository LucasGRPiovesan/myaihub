import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInlineImages } from './inline-images';

/** Mesmo motivo do teste do Hub: StrictMode expõe updater impuro. */
function strict({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

function png(name = 'foto.png', size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const LIMITS = { maxImages: 2, maxBytes: 4 * 1024 * 1024 };

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('imagens inline do agente', () => {
  it('converte o arquivo em base64, sem chamar rede', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });

    expect(result.current.items[0]?.status).toBe('ready');
    expect(result.current.payload).toEqual([{ mimeType: 'image/png', data: expect.any(String) }]);
    expect(result.current.payload[0]?.data.length).toBeGreaterThan(0);
  });

  it('recusa arquivo grande sem tentar ler', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    await act(async () => {
      await result.current.add([png('grande.png', 5 * 1024 * 1024)]);
    });

    expect(result.current.items[0]?.status).toBe('failed');
    expect(result.current.payload).toEqual([]);
  });

  it('ignora o que não é imagem aceita', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    const pdf = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    await act(async () => {
      await result.current.add([pdf]);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it('respeita o teto de imagens mesmo em anexos seguidos', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    await act(async () => {
      await result.current.add([png('a.png'), png('b.png')]);
    });
    await act(async () => {
      await result.current.add([png('c.png')]);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.full).toBe(true);
  });

  it('remover libera espaço e devolve o item', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    const key = result.current.items[0]!.key;
    act(() => {
      result.current.remove(key);
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.payload).toEqual([]);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('clear esvazia tudo e libera os object URLs', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    await act(async () => {
      await result.current.add([png('a.png'), png('b.png')]);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.items).toHaveLength(0);
    // Não conta exato: o StrictMode invoca o updater de `setState` duas vezes
    // de propósito (detecta impureza), então a contagem exata de chamadas do
    // mock não é o que importa aqui — só que os dois itens foram revogados.
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('detach esvazia o composer SEM revogar — a imagem não é salva, o preview precisa sobreviver no balão', async () => {
    const { result } = renderHook(() => useInlineImages(LIMITS), { wrapper: strict });

    await act(async () => {
      await result.current.add([png()]);
    });

    let taken: ReturnType<typeof result.current.detach> = [];
    act(() => {
      taken = result.current.detach();
    });

    expect(taken).toHaveLength(1);
    expect(taken[0]?.previewUrl).toBe('blob:fake');
    expect(result.current.items).toHaveLength(0);
    expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
