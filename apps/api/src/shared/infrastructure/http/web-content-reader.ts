import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Logger, WebContent, WebContentReader } from '../../application/ports.js';
import { readVisualIdentity } from './visual-identity.js';

/**
 * Leitor de páginas informadas pelo usuário (§16, risco 7).
 *
 * A superfície de ataque aqui é SSRF: o usuário escolhe a URL, e o servidor a
 * busca com as credenciais de rede dele. Por isso a validação é feita sobre o
 * IP RESOLVIDO, não sobre o texto do host — `http://meu-site.com` pode resolver
 * para 169.254.169.254 e entregar credenciais de metadata da nuvem.
 *
 * Redirect é `manual` e cada salto passa pela mesma checagem: validar só a URL
 * inicial deixa o alvo redirecionar para a rede interna depois do "sim".
 */

const MAX_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 12_000;

/**
 * Folhas de estilo externas: quantas, e quanto de cada uma.
 *
 * A marca quase nunca está no `<style>` da página — em site feito com framework
 * ela vive num CSS gerado. Sem buscar esses arquivos, a varredura visual lê o
 * reset do framework e conclui que o site é cinza.
 *
 * O limite é apertado porque cada arquivo é uma requisição a mais, com a mesma
 * validação de SSRF, num caminho que o usuário dispara escrevendo uma URL. Três
 * arquivos pegam o CSS principal de qualquer site real; o resto é tema de
 * plugin. E 256KB é mais do que o suficiente: a cor da marca aparece no começo,
 * junto das variáveis e do cabeçalho.
 */
const MAX_STYLESHEETS = 3;
const MAX_STYLESHEET_BYTES = 256 * 1024;

/** Faixas privadas, loopback, link-local e metadata de nuvem. */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a, b] = parts as [number, number];

  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local, onde vivem os metadata endpoints.
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — CGNAT.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::') return true;
  // fc00::/7 (unique local) e fe80::/10 (link-local).
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9')) return true;
  if (value.startsWith('fea') || value.startsWith('feb')) return true;
  // IPv4 mapeado: ::ffff:127.0.0.1 burlaria a checagem v4 se passasse aqui.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  // Não é IP: não sabemos o que é, então não vai.
  return true;
}

/** Extrai texto legível de HTML sem trazer um parser inteiro para o bundle. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';

  const text = html
    // Script e style não são conteúdo — e é onde mora o payload de injeção.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Quebra de bloco vira parágrafo: sem isto o texto vira uma linha só.
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // O NBSP que sobra do &nbsp; entra ESCAPADO, nunca literal: no fonte ele
    // seria um caractere invisível que ninguém consegue revisar.
    .replace(/[ \t\u00a0]+/g, ' ')
    // A quebra de bloco vira '\n' e a tag seguinte vira espaço: sem aparar aqui,
    // cada linha do texto extraído começa com um espaço solto.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title: decodeEntities(title), text };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

export class HttpWebContentReader implements WebContentReader {
  constructor(private readonly logger: Logger) {}

  async read(url: string): Promise<WebContent | null> {
    try {
      return await this.fetchChain(url);
    } catch (error) {
      // Site fora do ar ou proibido não é erro da operação: o usuário continua
      // podendo descrever o negócio por escrito. Cai para `null`, e o runner
      // avisa no painel.
      this.logger.warn(
        { url, err: error instanceof Error ? error.message : String(error) },
        'não foi possível ler a URL informada',
      );
      return null;
    }
  }

  private async fetchChain(startUrl: string): Promise<WebContent | null> {
    let current = startUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = await this.validate(current);
      if (!target) return null;

      const response = await fetch(target.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Identificação honesta: um site pode querer bloquear, e tem direito.
          'User-Agent': 'MyAIHub/1.0 (+leitor de briefing)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        // Revalida o destino: é aqui que o ataque por redirect seria barrado.
        current = new URL(location, target).href;
        continue;
      }

      if (!response.ok) return null;

      const type = response.headers.get('content-type') ?? '';
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;

      const body = await this.readCapped(response, MAX_BYTES);
      const isHtml = /html|xml/i.test(type);
      const { title, text } = isHtml ? htmlToText(body) : { title: '', text: body.trim() };

      if (!text) return null;

      const truncated = text.length > MAX_TEXT_CHARS;

      // A varredura visual acontece ANTES de o HTML virar texto — depois dele
      // não existe mais cor, fonte nem forma para ler. É a razão de o corpo
      // cru continuar vivo até aqui.
      const visual = isHtml
        ? readVisualIdentity(body, await this.readStylesheets(body, target), target.href)
        : undefined;

      return {
        url: target.href,
        title: title || target.hostname,
        text: truncated ? `${text.slice(0, MAX_TEXT_CHARS)}\n[…conteúdo truncado]` : text,
        truncated,
        ...(visual ? { visual } : {}),
      };
    }

    return null;
  }

  /** `null` quando a URL é proibida. */
  private async validate(raw: string): Promise<URL | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    // Allowlist de esquema: `file:`, `gopher:` e afins não passam nem por engano.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const literal = isIP(url.hostname);
    if (literal) {
      return isBlockedAddress(url.hostname) ? null : url;
    }

    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0) return null;

    // TODOS os endereços precisam ser públicos: um host que resolve para um IP
    // público e um privado não é confiável — o cliente pode escolher o segundo.
    for (const address of addresses) {
      if (isBlockedAddress(address.address)) return null;
    }

    return url;
  }

  /**
   * As folhas de estilo ligadas pela página, concatenadas.
   *
   * Cada uma passa pela MESMA validação de SSRF da página: um `<link>` é uma
   * URL escolhida por um site de terceiro, e confiar nela porque a página que a
   * declarou passou seria abrir exatamente o buraco que a validação fecha —
   * `<link href="http://169.254.169.254/...">` num site hostil.
   *
   * Falha de uma folha não derruba nada: a varredura visual é um extra sobre a
   * leitura do texto, e ficar sem uma cor é melhor que perder o briefing.
   */
  private async readStylesheets(html: string, pageUrl: URL): Promise<string> {
    const hrefs: string[] = [];

    for (const link of html.matchAll(/<link[^>]+>/gi)) {
      const tag = link[0];
      if (!/rel=["'][^"']*stylesheet/i.test(tag)) continue;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) continue;
      // O CSS do provedor de fontes não tem cor nenhuma — só @font-face. As
      // famílias dele já são lidas do próprio HTML, e buscá-lo gastaria uma das
      // três vagas.
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href)) continue;

      try {
        const absoluto = new URL(href, pageUrl).href;
        if (!hrefs.includes(absoluto)) hrefs.push(absoluto);
      } catch {
        // href malformado em HTML de terceiro é rotina.
      }
      if (hrefs.length >= MAX_STYLESHEETS) break;
    }

    const folhas = await Promise.all(hrefs.map((href) => this.readStylesheet(href)));
    return folhas.filter(Boolean).join('\n');
  }

  private async readStylesheet(href: string): Promise<string> {
    try {
      const target = await this.validate(href);
      if (!target) return '';

      const response = await fetch(target.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': 'MyAIHub/1.0 (+leitor de briefing)',
          Accept: 'text/css',
        },
      });

      if (!response.ok) return '';
      if (!/text\/css/i.test(response.headers.get('content-type') ?? '')) return '';

      return await this.readCapped(response, MAX_STYLESHEET_BYTES);
    } catch (error) {
      this.logger.warn(
        { href, err: error instanceof Error ? error.message : String(error) },
        'não foi possível ler a folha de estilo',
      );
      return '';
    }
  }

  /** Lê no máximo `limit` bytes: um download infinito derrubaria o processo. */
  private async readCapped(response: Response, limit: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';

    const decoder = new TextDecoder('utf-8');
    let size = 0;
    let out = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (size >= limit) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    return out;
  }
}
