import { z } from 'zod';
import type { CanonicalSchemaSet } from './migrate.js';

/**
 * Brand Identity canônica do projeto (§4.4, Fase 5).
 *
 * É a única parte do sistema que o PÚBLICO vê antes de qualquer fala: nome
 * exibido, cor, logo, aviso legal. Vive separada do Project Profile de
 * propósito — o perfil diz o que o negócio É, isto diz como ele se APRESENTA, e
 * as duas coisas mudam por motivos diferentes. Trocar a cor da marca não pode
 * criar uma versão do documento que descreve o que a empresa vende.
 *
 * Ao contrário das outras facetas do projeto, aqui NÃO há lista de
 * `CanonicalItem`. Identidade visual é um conjunto de campos escalares — cor
 * não tem `semanticKey` nem `enforcement`, e fingir que tem produziria um
 * vocabulário que ninguém consegue usar. A mutação correspondente é singleton
 * (`SET_BRAND_IDENTITY`), na mesma forma de `SET_AGENT_ENGAGEMENT`.
 */

/** Cor em hexadecimal. Restrito porque vai direto para CSS de página pública. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor hexadecimal de 6 dígitos, como #1f6feb.');

/**
 * O TOM é orientação de escrita, não decoração.
 *
 * Ele atravessa para o prompt do agente publicado — é a única parte da
 * identidade com efeito sobre o que o agente FALA, e não só sobre o que a
 * página mostra. Sem isto, "nossa marca é informal" ficaria no CSS enquanto o
 * agente continuava escrevendo como um contrato.
 */
export const BRAND_VOICE_TONES = ['FORMAL', 'NEUTRO', 'PROXIMO', 'DESCONTRAIDO'] as const;
export type BrandVoiceTone = (typeof BRAND_VOICE_TONES)[number];

export const BRAND_VOICE_TONE_LABELS: Record<BrandVoiceTone, string> = {
  FORMAL: 'Formal',
  NEUTRO: 'Neutro',
  PROXIMO: 'Próximo',
  DESCONTRAIDO: 'Descontraído',
};

/** Como cada tom deve soar. Vai para o prompt: é o que o agente lê. */
export const BRAND_VOICE_TONE_GUIDANCE: Record<BrandVoiceTone, string> = {
  FORMAL: 'Trate por você com registro formal. Sem gíria, sem emoji, sem abreviação.',
  NEUTRO: 'Registro neutro e profissional. Nem cerimonioso, nem íntimo.',
  PROXIMO: 'Registro próximo e cordial, como um colega prestativo. Emoji só se o outro usar.',
  DESCONTRAIDO: 'Registro leve e informal, sem perder a competência. Frases curtas.',
};

/**
 * A FAMÍLIA TIPOGRÁFICA, e por que só o NOME dela é guardado.
 *
 * A fonte do site do cliente é carregada de verdade na página pública — é o que
 * faz o chat parecer o site, e não o MyAIHub. O caminho óbvio seria guardar a
 * URL do `<link>` que o site usa e repeti-la; isso seria injeção de recurso
 * externo, com a URL escolhida por um site de terceiro ou por um modelo que leu
 * esse site. Guarda-se o NOME, validado contra um charset estreito, e quem monta
 * a URL do provedor é o nosso código.
 *
 * `SYSTEM` significa "não carregue nada": a pilha nativa do dispositivo, que é o
 * certo quando o site usa Arial/Helvetica ou quando não deu para identificar.
 */
export const FONT_SOURCES = ['SYSTEM', 'GOOGLE'] as const;
export type FontSource = (typeof FONT_SOURCES)[number];

/** Letra, número, espaço e hífen. Nada que sirva para sair de uma query string. */
const fontFamily = z
  .string()
  .trim()
  .max(48)
  .regex(/^[A-Za-z0-9 -]*$/, 'Nome de fonte aceita apenas letras, números, espaço e hífen.')
  .default('');

/**
 * A GEOMETRIA da marca, em três degraus em vez de um número livre.
 *
 * Um site tem um jeito de cortar canto — reto, suave ou pílula — e é isso que o
 * olho reconhece. Guardar "11px" copiaria um valor que só faz sentido dentro da
 * grade do site original; os degraus atravessam para qualquer componente nosso.
 */
export const BRAND_SHAPES = ['SHARP', 'SOFT', 'ROUND'] as const;
export type BrandShape = (typeof BRAND_SHAPES)[number];

export const BRAND_SHAPE_RADIUS: Record<BrandShape, string> = {
  SHARP: '2px',
  SOFT: '10px',
  ROUND: '22px',
};

export const BRAND_SHAPE_LABELS: Record<BrandShape, string> = {
  SHARP: 'Reto',
  SOFT: 'Suave',
  ROUND: 'Arredondado',
};

export const canonicalBrandIdentityV1Schema = z.object({
  canonicalSchemaVersion: z.literal(1),

  /** Nome exibido ao público. Vazio = usa o nome do projeto. */
  displayName: z.string().trim().max(80).default(''),
  tagline: z.string().trim().max(160).default(''),

  colors: z
    .object({
      primary: hexColor.default('#1f6feb'),
      /** Cor do texto sobre a primária. Declarada, não calculada: contraste
       *  adivinhado por luminância erra justamente nos tons de meio. */
      onPrimary: hexColor.default('#ffffff'),
    })
    .default({ primary: '#1f6feb', onPrimary: '#ffffff' }),

  /** Id de MediaAsset (invariante 4: bytes fora do banco, atrás do port). */
  logoAssetId: z.string().max(40).nullable().default(null),
  avatarAssetId: z.string().max(40).nullable().default(null),

  voice: z
    .object({
      tone: z.enum(BRAND_VOICE_TONES).default('NEUTRO'),
      /** Orientação livre, quando o tom não basta. Entra no prompt como está. */
      guidance: z.string().trim().max(600).default(''),
      /** Palavras que a marca não usa. Vira regra concreta no prompt. */
      avoid: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    })
    .default({ tone: 'NEUTRO', guidance: '', avoid: [] }),

  /**
   * Rodapé legal da página pública (CNPJ, política, aviso de IA).
   *
   * Fica na identidade e não numa configuração de conta porque quem publica
   * pode ser um projeto de um cliente do usuário, com outra razão social.
   */
  legalFooter: z.string().trim().max(400).default(''),
});

/**
 * v2 — A IDENTIDADE INTEIRA, não só a cor da faixa do topo.
 *
 * A v1 guardava duas cores, e por isso a página pública só conseguia pintar o
 * cabeçalho: balão, fundo, chip e botão continuavam com os tokens do MyAIHub, e
 * quem publicava via o chat do cliente com a cara da nossa ferramenta. Cor de
 * marca isolada não é identidade visual — é um detalhe dela.
 *
 * O que entrou é exatamente o que a página precisa para se vestir por inteiro:
 * a superfície em que ela se desenha, o texto que vai por cima, a linha que
 * separa, a fonte e o jeito de cortar canto. Nada aqui é enfeite: cada campo
 * tem um componente do lado público que morre sem ele.
 */
export const canonicalBrandIdentityV2Schema = canonicalBrandIdentityV1Schema
  .omit({ canonicalSchemaVersion: true, colors: true })
  .extend({
    canonicalSchemaVersion: z.literal(2),

    colors: z
      .object({
        primary: hexColor.default('#1f6feb'),
        onPrimary: hexColor.default('#ffffff'),
        /** O fundo da página — atrás de tudo. */
        canvas: hexColor.default('#f7f8fb'),
        /** A superfície que se levanta do fundo: cartão, campo de entrada. */
        surface: hexColor.default('#ffffff'),
        /** Texto sobre `surface` e `canvas`. */
        text: hexColor.default('#0d111b'),
        /** Texto secundário: legenda, rodapé, estado. */
        textMuted: hexColor.default('#5a6478'),
        border: hexColor.default('#e3e7ef'),
        /**
         * VANTAGEM e DESVANTAGEM — a psicologia da cor pertence à MARCA, não ao
         * MyAIHub. Um comparativo publicado usava o verde/vermelho internos da
         * nossa ferramenta, que não têm relação nenhuma com a paleta que o
         * cliente aprovou; ficaria "fora da marca" mesmo quando correto no
         * conteúdo. Aqui são campos DECLARADOS, com um default neutro e
         * profissional — nunca calculados a partir da cor principal, porque
         * verde/vermelho "puxados" da primária tendem a sair dessaturados
         * demais para funcionar como sinal.
         */
        success: hexColor.default('#2c7a4b'),
        danger: hexColor.default('#a3311a'),
      })
      .default({
        primary: '#1f6feb',
        onPrimary: '#ffffff',
        canvas: '#f7f8fb',
        surface: '#ffffff',
        text: '#0d111b',
        textMuted: '#5a6478',
        border: '#e3e7ef',
        success: '#2c7a4b',
        danger: '#a3311a',
      }),

    typography: z
      .object({
        /** Vazio = a pilha nativa. Nunca uma URL — ver `FONT_SOURCES`. */
        headingFamily: fontFamily,
        bodyFamily: fontFamily,
        source: z.enum(FONT_SOURCES).default('SYSTEM'),
      })
      .default({ headingFamily: '', bodyFamily: '', source: 'SYSTEM' }),

    shape: z.enum(BRAND_SHAPES).default('SOFT'),
  });

export type CanonicalBrandIdentity = z.infer<typeof canonicalBrandIdentityV2Schema>;

export const BRAND_IDENTITY_SCHEMAS: CanonicalSchemaSet<CanonicalBrandIdentity> = {
  latest: 2,
  schema: canonicalBrandIdentityV2Schema,
  migrations: [
    {
      from: 1,
      to: 2,
      /**
       * Migração ADITIVA, na leitura: o documento gravado nunca é reescrito.
       *
       * Os defaults reproduzem exatamente o que a página pública v1 fazia — cor
       * de marca no cabeçalho, o resto claro e neutro. Uma marca antiga não
       * muda de aparência por causa desta migração; ela só passa a TER onde
       * declarar o resto.
       */
      migrate: (document) => ({ ...document }),
    },
  ],
};

/**
 * A identidade que vale quando o projeto ainda não definiu nenhuma.
 *
 * Ela EXISTE em vez de ser nula em toda parte: o chat público precisa de cor e
 * nome para se desenhar, e espalhar `?? '#1f6feb'` por cada leitor produziria
 * um default diferente em cada tela no dia em que alguém mudar um deles.
 */
export function defaultBrandIdentity(projectName: string): CanonicalBrandIdentity {
  return {
    canonicalSchemaVersion: 2,
    displayName: projectName,
    tagline: '',
    colors: {
      primary: '#1f6feb',
      onPrimary: '#ffffff',
      canvas: '#f7f8fb',
      surface: '#ffffff',
      text: '#0d111b',
      textMuted: '#5a6478',
      border: '#e3e7ef',
      success: '#2c7a4b',
      danger: '#a3311a',
    },
    typography: { headingFamily: '', bodyFamily: '', source: 'SYSTEM' },
    shape: 'SOFT',
    logoAssetId: null,
    avatarAssetId: null,
    voice: { tone: 'NEUTRO', guidance: '', avoid: [] },
    legalFooter: '',
  };
}

/** Resumo humano derivado do canônico — a UI mostra, a verdade fica no documento. */
export function summarizeBrandIdentity(brand: CanonicalBrandIdentity): string[] {
  const lines: string[] = [];
  if (brand.displayName) lines.push(`Nome exibido: ${brand.displayName}`);
  if (brand.tagline) lines.push(`Tagline: ${brand.tagline}`);
  lines.push(`Cor principal: ${brand.colors.primary}`);
  lines.push(`Fundo: ${brand.colors.canvas} · texto: ${brand.colors.text}`);
  if (brand.typography.bodyFamily || brand.typography.headingFamily) {
    lines.push(
      `Tipografia: títulos em ${brand.typography.headingFamily || 'pilha nativa'}, ` +
        `texto em ${brand.typography.bodyFamily || 'pilha nativa'}`,
    );
  }
  lines.push(`Forma: ${BRAND_SHAPE_LABELS[brand.shape]}`);
  lines.push(`Tom de voz: ${BRAND_VOICE_TONE_LABELS[brand.voice.tone]}`);
  if (brand.voice.guidance) lines.push(`Orientação de voz: ${brand.voice.guidance}`);
  if (brand.voice.avoid.length > 0) lines.push(`Evita: ${brand.voice.avoid.join(', ')}`);
  if (brand.logoAssetId) lines.push('Logo definido.');
  if (brand.legalFooter) lines.push(`Rodapé legal: ${brand.legalFooter}`);
  return lines;
}

/**
 * A MARCA VIRANDO TEMA — o que faz a página pública deixar de parecer MyAIHub.
 *
 * A página inteira já é escrita em cima de variáveis CSS (`--color-accent`,
 * `--color-canvas`, …). Então vestir a marca não é reescrever componente por
 * componente: é redefinir as MESMAS variáveis no escopo daquela página. Um
 * componente novo do chat nasce com a marca aplicada sem ninguém lembrar disso,
 * que é justamente o contrário do que acontecia — o cabeçalho tinha um
 * `style={{ backgroundColor: marca.colors.primary }}` e todo o resto ficava com
 * o tema da nossa ferramenta.
 *
 * Fica em `packages/shared` porque o mesmo mapa serve a prévia dentro do
 * produto e à página pública: duas cópias divergiriam, e a prévia passaria a
 * mentir sobre o que o visitante vê.
 */
export function brandCssVariables(brand: CanonicalBrandIdentity): Record<string, string> {
  const fontes = brandFontStacks(brand);

  return {
    '--color-accent': brand.colors.primary,
    '--color-accent-hover': brand.colors.primary,
    '--color-accent-foreground': brand.colors.onPrimary,
    // O chip de sugestão é a primária DILUÍDA no fundo: a mesma cor cheia por
    // trás de um texto pequeno briga com a leitura da conversa.
    '--color-accent-soft': `color-mix(in oklab, ${brand.colors.primary} 14%, ${brand.colors.surface})`,
    '--color-canvas': brand.colors.canvas,
    '--color-surface': brand.colors.surface,
    '--color-surface-muted': brand.colors.canvas,
    '--color-surface-sunken': `color-mix(in oklab, ${brand.colors.text} 6%, ${brand.colors.surface})`,
    '--color-text': brand.colors.text,
    '--color-text-muted': brand.colors.textMuted,
    '--color-text-subtle': brand.colors.textMuted,
    '--color-border': brand.colors.border,
    '--color-border-strong': brand.colors.border,
    /*
      VANTAGEM e DESVANTAGEM entram no MESMO tema — sem isto, um comparativo
      dentro do chat da marca usaria o verde/vermelho internos do MyAIHub, que
      não têm relação com a paleta que o cliente aprovou.
    */
    '--color-success': brand.colors.success,
    '--color-success-soft': `color-mix(in oklab, ${brand.colors.success} 14%, ${brand.colors.surface})`,
    '--color-danger': brand.colors.danger,
    '--color-danger-soft': `color-mix(in oklab, ${brand.colors.danger} 14%, ${brand.colors.surface})`,
    '--font-sans': fontes.body,
    '--font-heading': fontes.heading,
    '--radius-card': BRAND_SHAPE_RADIUS[brand.shape],
    '--radius-control': BRAND_SHAPE_RADIUS[brand.shape],
  };
}

/** A família da marca com uma pilha de segurança atrás — fonte que não carrega não pode deixar a página sem texto. */
export function brandFontStacks(brand: CanonicalBrandIdentity): { heading: string; body: string } {
  const fallback = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const stack = (family: string): string => (family ? `'${family}', ${fallback}` : `${fallback}`);

  return {
    heading: stack(brand.typography.headingFamily || brand.typography.bodyFamily),
    body: stack(brand.typography.bodyFamily || brand.typography.headingFamily),
  };
}

/**
 * A URL do provedor de fontes, MONTADA POR NÓS.
 *
 * O nome da família já é validado no schema contra um charset estreito, e é só
 * ele que atravessa; aqui ele é codificado de novo antes de virar query string.
 * Em nenhum momento uma URL escrita pelo site do cliente — ou pelo modelo que
 * leu esse site — chega ao `<link>` da página.
 *
 * `null` quando não há o que carregar, que é o caso de `SYSTEM`.
 */
export function googleFontsHref(brand: CanonicalBrandIdentity): string | null {
  if (brand.typography.source !== 'GOOGLE') return null;

  const familias = [brand.typography.headingFamily, brand.typography.bodyFamily]
    .filter((family): family is string => Boolean(family))
    .filter((family, index, todas) => todas.indexOf(family) === index);

  if (familias.length === 0) return null;

  const query = familias
    .map((family) => `family=${encodeURIComponent(family)}:wght@400;500;600;700`)
    .join('&');

  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/**
 * O que falta para a identidade servir a uma página pública.
 *
 * Não bloqueia publicação: uma identidade vazia é um default honesto, e
 * impedir a publicação por causa de uma cor devolveria ao usuário um trabalho
 * que o sistema sabe fazer sozinho. Isto é o que a tela EXIBE como pendência.
 */
export function brandIdentityGaps(brand: CanonicalBrandIdentity): string[] {
  const gaps: string[] = [];
  if (!brand.displayName) gaps.push('Sem nome exibido — o público vê o nome do projeto.');
  if (!brand.logoAssetId) gaps.push('Sem logo.');
  if (!brand.tagline) gaps.push('Sem tagline: a página abre só com o nome.');
  if (!brand.typography.bodyFamily && !brand.typography.headingFamily) {
    gaps.push('Sem tipografia própria: a página usa a fonte padrão do dispositivo.');
  }
  if (!brand.legalFooter) gaps.push('Sem rodapé legal (CNPJ, política, aviso de IA).');
  return gaps;
}
