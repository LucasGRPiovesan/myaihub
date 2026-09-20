/**
 * A IDENTIDADE VISUAL DE UM SITE, extraída do que ele serve.
 *
 * O leitor de páginas jogava fora exatamente isto: `<style>` e `<script>` eram
 * removidos como "payload de injeção" e todo atributo virava espaço. Sobrava
 * texto — então o S.O podia descrever o negócio a partir do site e não tinha
 * como saber de que cor ele é. A consequência aparecia no fim da linha: o chat
 * publicado saía com a cor e a fonte do MyAIHub, para um visitante que acabou
 * de clicar num anúncio daquela marca.
 *
 * ========== COLETA É CÓDIGO; INTERPRETAÇÃO É DO MODELO ==========
 *
 * O que está aqui é mecânico e conferível: contar ocorrências de cor, ler
 * `font-family`, achar o `<link>` do provedor de fontes, medir o raio de borda
 * mais usado. Nada aqui decide qual cor é "a da marca" — essa é uma leitura, e
 * leitura é do modelo, que depois devolve uma `SET_BRAND_IDENTITY` tipada como
 * qualquer outra mutação (invariante 6).
 *
 * Contar é o que separa a cor da marca do resto: um site tem dezenas de cores,
 * e a que aparece em botão e cabeçalho aparece MUITAS vezes. Entregar ao modelo
 * uma lista sem frequência seria entregar ruído.
 */

import type { ColorEvidence, VisualEvidence } from '../../application/ports.js';

const MAX_COLORS = 12;
const MAX_FONTS = 6;

// ---------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------

/** `#abc` → `#aabbcc`; devolve null para o que não for cor de 3 ou 6 dígitos. */
function normalizeHex(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const curto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (curto) return `#${curto[1]!}${curto[1]!}${curto[2]!}${curto[2]!}${curto[3]!}${curto[3]!}`;
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const canal = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

/**
 * A propriedade CSS que carrega a cor, quando dá para saber.
 *
 * O papel importa mais que a cor isolada: `#ffffff` em `background` é a
 * superfície do site; o mesmo `#ffffff` em `color` é texto sobre algo escuro.
 * Sem isso o modelo receberia uma lista de cores sem nada que diga onde cada
 * uma vive, e escolheria a mais frequente para tudo.
 */
function roleOf(declaration: string): string | null {
  const property = /([a-z-]+)\s*:[^:]*$/.exec(declaration.toLowerCase())?.[1];
  if (!property) return null;
  if (property.includes('background')) return 'fundo';
  if (property === 'color') return 'texto';
  if (property.includes('border')) return 'borda';
  if (property.includes('fill') || property.includes('stroke')) return 'ícone';
  if (property.includes('shadow')) return 'sombra';
  return null;
}

/**
 * Cores puramente estruturais que todo site tem e que não dizem nada sobre a marca.
 *
 * Transparente e preto/branco absolutos aparecem em qualquer reset de CSS. Eles
 * continuam entrando quando aparecem MUITO (um site de fundo branco precisa
 * dizer isso), mas nunca como candidatos a cor de marca — quem decide isso é o
 * modelo, e é por isso que o papel viaja junto.
 */
const RUIDO = new Set(['transparent', 'inherit', 'currentcolor', 'none']);

export function extractColors(css: string): ColorEvidence[] {
  const encontradas = new Map<string, { count: number; roles: Set<string> }>();

  const registrar = (hex: string, declaration: string): void => {
    const atual = encontradas.get(hex) ?? { count: 0, roles: new Set<string>() };
    atual.count += 1;
    const role = roleOf(declaration);
    if (role) atual.roles.add(role);
    encontradas.set(hex, atual);
  };

  // O trecho que ANTECEDE a cor é o que revela a propriedade: `background:#fff`.
  const hexPattern = /(^|[^&\w])(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\b/g;
  let match: RegExpExecArray | null;

  while ((match = hexPattern.exec(css)) !== null) {
    const hex = normalizeHex(match[2]!);
    if (!hex) continue;
    registrar(hex, css.slice(Math.max(0, match.index - 60), match.index));
  }

  const rgbPattern = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+))?\s*\)/gi;
  while ((match = rgbPattern.exec(css)) !== null) {
    // Cor quase transparente é sombra e sobreposição, nunca a cor da marca.
    const alpha = match[4];
    if (alpha !== undefined) {
      const valor = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
      if (Number.isFinite(valor) && valor < 0.6) continue;
    }
    const hex = rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]));
    registrar(hex, css.slice(Math.max(0, match.index - 60), match.index));
  }

  for (const nome of RUIDO) encontradas.delete(nome);

  return [...encontradas.entries()]
    .map(([hex, dados]) => ({ hex, count: dados.count, roles: [...dados.roles] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COLORS);
}

// ---------------------------------------------------------------------------
// Tipografia
// ---------------------------------------------------------------------------

/** Nomes genéricos não são a fonte do site: são o que vem depois dela. */
const GENERICAS = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
]);

export function extractFonts(css: string): Array<{ family: string; count: number; heading: boolean }> {
  const encontradas = new Map<string, { count: number; heading: boolean }>();
  const pattern = /font-family\s*:\s*([^;}"]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    // Só a PRIMEIRA da pilha é a escolha; o resto é plano B do próprio site.
    const primeira = match[1]!.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
    const normal = primeira.toLowerCase();
    if (!primeira || GENERICAS.has(normal) || primeira.startsWith('var(')) continue;
    if (!/^[A-Za-z0-9 -]{2,48}$/.test(primeira)) continue;

    // A regra que declara a fonte de título costuma nomear h1..h6 logo antes.
    const contexto = css.slice(Math.max(0, match.index - 200), match.index).toLowerCase();
    const heading = /h[1-4]\b|heading|title|display/.test(contexto);

    const atual = encontradas.get(primeira) ?? { count: 0, heading: false };
    encontradas.set(primeira, { count: atual.count + 1, heading: atual.heading || heading });
  }

  return [...encontradas.entries()]
    .map(([family, dados]) => ({ family, count: dados.count, heading: dados.heading }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_FONTS);
}

/**
 * Fonte de ÍCONE não é fonte de marca.
 *
 * Medido no site real da Sankar: ele carrega `Montserrat` e
 * `Material Symbols Outlined` do mesmo provedor, e a segunda é um alfabeto de
 * pictogramas. Sem este filtro ela entra na lista com o mesmo peso da primeira,
 * e uma página de atendimento inteira escrita em símbolos é uma falha que
 * ninguém testa antes de publicar.
 */
const FONTES_DE_ICONE = /material\s*(symbols|icons)|font\s*awesome|glyphicons|icomoon|\bicons?\b/i;

/**
 * As famílias que o site CARREGA de um provedor.
 *
 * É o sinal mais forte que existe: ninguém paga o custo de baixar uma fonte que
 * não é a da marca. Vale mais que a contagem de `font-family`, que também conta
 * as pilhas de fallback herdadas de framework.
 */
export function extractWebFonts(html: string): string[] {
  const familias = new Set<string>();

  const links = html.matchAll(/<link[^>]+href=["']([^"']*fonts\.googleapis\.com[^"']*)["']/gi);
  for (const link of links) {
    const href = link[1]!.replace(/&amp;/g, '&');
    for (const family of href.matchAll(/family=([^&:]+)/gi)) {
      const nome = decodeURIComponent(family[1]!).replace(/\+/g, ' ').trim();
      if (/^[A-Za-z0-9 -]{2,48}$/.test(nome) && !FONTES_DE_ICONE.test(nome)) familias.add(nome);
    }
  }

  // `@font-face` próprio: o nome declarado é o que as regras usam depois.
  for (const face of html.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi)) {
    const nome = face[1]!.trim();
    if (
      /^[A-Za-z0-9 -]{2,48}$/.test(nome) &&
      !GENERICAS.has(nome.toLowerCase()) &&
      !FONTES_DE_ICONE.test(nome)
    ) {
      familias.add(nome);
    }
  }

  return [...familias].slice(0, MAX_FONTS);
}

// ---------------------------------------------------------------------------
// Forma
// ---------------------------------------------------------------------------

export function extractRadii(css: string): Array<{ px: number; count: number }> {
  const encontrados = new Map<number, number>();

  for (const match of css.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem|em)/gi)) {
    const valor = Number(match[1]);
    if (!Number.isFinite(valor)) continue;
    // rem/em viram px pela raiz padrão: o que interessa é a ORDEM de grandeza,
    // não o pixel exato — o destino é um degrau (reto/suave/arredondado).
    const px = match[2]!.toLowerCase() === 'px' ? valor : valor * 16;
    if (px > 200) continue;
    const chave = Math.round(px);
    encontrados.set(chave, (encontrados.get(chave) ?? 0) + 1);
  }

  return [...encontrados.entries()]
    .map(([px, count]) => ({ px, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Metadados e logo
// ---------------------------------------------------------------------------

function metaContent(html: string, attribute: string, value: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${value}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const direto = pattern.exec(html)?.[1];
  if (direto) return direto.trim();

  // O mesmo `<meta>` com os atributos na ordem inversa — acontece o tempo todo.
  const invertido = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${attribute}=["']${value}["']`,
    'i',
  ).exec(html)?.[1];
  return invertido?.trim() ?? null;
}

export function extractLogoUrls(html: string, baseUrl: string): string[] {
  const candidatos: string[] = [];

  const ogImage = metaContent(html, 'property', 'og:image') ?? metaContent(html, 'name', 'og:image');
  if (ogImage) candidatos.push(ogImage);

  // `apple-touch-icon` costuma ser a marca em alta resolução e sem texto.
  for (const rel of ['apple-touch-icon', 'icon', 'shortcut icon']) {
    const href = new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*href=["']([^"']+)["']`, 'i')
      .exec(html)?.[1];
    if (href) candidatos.push(href);
  }

  // Uma `<img>` cujo nome ou alt diz "logo", no primeiro terço do documento.
  const topo = html.slice(0, Math.floor(html.length / 3));
  for (const img of topo.matchAll(/<img[^>]+>/gi)) {
    const tag = img[0];
    if (!/logo|brand|marca/i.test(tag)) continue;
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) candidatos.push(src);
  }

  const absolutos: string[] = [];
  for (const candidato of candidatos) {
    try {
      const url = new URL(candidato, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (!absolutos.includes(url.href)) absolutos.push(url.href);
    } catch {
      // URL malformada no HTML de terceiro é rotina, não erro nosso.
    }
  }

  return absolutos.slice(0, 4);
}

/**
 * Junta HTML e CSS num retrato visual do site.
 *
 * `css` vem separado porque parte dele mora em arquivo externo: o `<style>` da
 * página quase nunca é onde a marca está declarada em site feito com framework.
 */
export function readVisualIdentity(html: string, css: string, baseUrl: string): VisualEvidence {
  const inlineStyles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] ?? '')
    .join('\n');

  // Atributos `style=""` contam: é onde vive a cor de um bloco montado no CMS.
  const styleAttrs = [...html.matchAll(/style=["']([^"']+)["']/gi)]
    .map((match) => match[1] ?? '')
    .join(';');

  const todoCss = [inlineStyles, styleAttrs, css].join('\n');

  return {
    colors: extractColors(todoCss),
    fonts: extractFonts(todoCss),
    webFonts: extractWebFonts(html),
    themeColor: normalizeHex(metaContent(html, 'name', 'theme-color') ?? ''),
    radii: extractRadii(todoCss),
    logoUrls: extractLogoUrls(html, baseUrl),
    siteName: metaContent(html, 'property', 'og:site_name'),
    description:
      metaContent(html, 'name', 'description') ?? metaContent(html, 'property', 'og:description'),
  };
}

