import { googleFontsHref, type CanonicalBrandIdentity } from '@myaihub/shared';
import { useEffect } from 'react';

/**
 * Carrega a fonte da marca enquanto a tela precisar dela.
 *
 * Existe em um lugar só porque quem usa são DOIS: a página pública do
 * atendimento e a prévia da tela de identidade. A prévia anuncia mostrar "as
 * cores, a fonte e a forma" — sem carregar a família ela cairia na pilha nativa
 * e mentiria justamente sobre o campo que o usuário acabou de preencher. Duas
 * implementações divergiriam, e a que divergiria é a prévia, que é a única das
 * duas que ninguém confere contra a realidade.
 *
 * A família chega como NOME, validada no canônico contra um charset estreito, e
 * quem monta a URL é `googleFontsHref` — nunca o site do cliente nem o modelo
 * que o leu.
 *
 * O `<link>` sai do documento ao desmontar: navegar entre duas marcas deixaria
 * as duas fontes penduradas.
 */
export function useBrandFont(brand: CanonicalBrandIdentity | null | undefined): void {
  const href = brand ? googleFontsHref(brand) : null;

  useEffect(() => {
    if (!href) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
    // A dependência é a URL, não o objeto: a marca vem de uma query que devolve
    // um objeto novo a cada refetch, e com ele aqui o link seria recriado a
    // cada volta — piscando a fonte na tela de quem está editando.
  }, [href]);
}
