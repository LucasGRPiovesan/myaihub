import { canonicalBrandIdentityV2Schema, type CanonicalBrandIdentity } from '@myaihub/shared';
import { AppError } from '../../../shared/domain/errors.js';
import type {
  ApplyMutationsResult,
  MutationContext,
  MutationRejection,
} from '../../myaihub/domain/mutation-applier.js';
import type { BrandMutation, BrandMutationKind } from './brand-mutations.js';

/**
 * Aplica mutações de identidade de marca.
 *
 * MERGE campo a campo, nunca substituição do documento. O pedido "deixa a cor
 * mais escura" chega como uma mutação com um campo; aceitar o documento inteiro
 * de volta faria o modelo reescrever o rodapé legal e a orientação de voz sem
 * ninguém ter pedido — e a perda seria silenciosa, que é o pior tipo.
 */
export class BrandIdentityMutationApplier {
  apply(
    current: CanonicalBrandIdentity,
    mutations: BrandMutation[],
    context: MutationContext<BrandMutationKind>,
  ): ApplyMutationsResult<CanonicalBrandIdentity, BrandMutation> {
    const applied: BrandMutation[] = [];
    const rejected: MutationRejection[] = [];
    const adjustments: string[] = [];

    let draft: CanonicalBrandIdentity = { ...current };

    for (const mutation of mutations) {
      if (!context.allowedMutations.includes(mutation.kind)) {
        rejected.push({
          kind: mutation.kind,
          reason: 'Esta operação não pode alterar a identidade de marca.',
        });
        continue;
      }

      draft = {
        ...draft,
        ...(mutation.displayName !== undefined ? { displayName: mutation.displayName } : {}),
        ...(mutation.tagline !== undefined ? { tagline: mutation.tagline } : {}),
        ...(mutation.logoAssetId !== undefined ? { logoAssetId: mutation.logoAssetId } : {}),
        ...(mutation.avatarAssetId !== undefined ? { avatarAssetId: mutation.avatarAssetId } : {}),
        ...(mutation.legalFooter !== undefined ? { legalFooter: mutation.legalFooter } : {}),
        colors: {
          primary: mutation.primaryColor ?? draft.colors.primary,
          onPrimary: mutation.onPrimaryColor ?? draft.colors.onPrimary,
          canvas: mutation.canvasColor ?? draft.colors.canvas,
          surface: mutation.surfaceColor ?? draft.colors.surface,
          text: mutation.textColor ?? draft.colors.text,
          textMuted: mutation.textMutedColor ?? draft.colors.textMuted,
          border: mutation.borderColor ?? draft.colors.border,
          success: mutation.successColor ?? draft.colors.success,
          danger: mutation.dangerColor ?? draft.colors.danger,
        },
        typography: {
          headingFamily: mutation.headingFamily ?? draft.typography.headingFamily,
          bodyFamily: mutation.bodyFamily ?? draft.typography.bodyFamily,
          source: mutation.fontSource ?? draft.typography.source,
        },
        ...(mutation.shape !== undefined ? { shape: mutation.shape } : {}),
        voice: {
          tone: mutation.tone ?? draft.voice.tone,
          guidance: mutation.voiceGuidance ?? draft.voice.guidance,
          avoid: mutation.avoid ?? draft.voice.avoid,
        },
      };

      applied.push(mutation);
    }

    // Trocar a primária sem dizer a cor do texto sobre ela é o pedido normal —
    // e é assim que nasce texto branco sobre amarelo. O contraste é CALCULADO
    // só neste caso, e um valor declarado pelo usuário nunca é sobrescrito.
    if (applied.some((mutation) => mutation.primaryColor && !mutation.onPrimaryColor)) {
      const legivel = readableOn(draft.colors.primary);
      if (legivel !== draft.colors.onPrimary) {
        draft = { ...draft, colors: { ...draft.colors, onPrimary: legivel } };
        adjustments.push(
          `Ajustei a cor do texto sobre a principal para ${legivel}, senão ficaria ilegível.`,
        );
      }
    }

    /*
      TEXTO ILEGÍVEL SOBRE A SUPERFÍCIE É FALHA TOTAL, e aqui a regra é mais
      forte que a de cima: o par declarado é VERIFICADO, não só preenchido
      quando falta.

      A diferença tem motivo. A cor sobre a primária é uma escolha estética
      dentro de uma faixa; a cor do texto sobre o fundo da página é a diferença
      entre o visitante ler o atendimento e ver uma tela vazia. Como a paleta
      agora pode vir de uma VARREDURA de site — onde fundo e texto foram
      colhidos de regras CSS diferentes, sem garantia de que conviviam no mesmo
      lugar —, aceitar o par sem conferir é publicar no escuro.

      Só corrige o que reprova no piso da WCAG, e diz o que fez.
    */
    if (applied.length > 0) {
      const contrasteTexto = contrastRatio(draft.colors.text, draft.colors.surface);
      if (contrasteTexto < 4.5) {
        const legivel = readableOn(draft.colors.surface);
        draft = { ...draft, colors: { ...draft.colors, text: legivel } };
        adjustments.push(
          `A cor do texto não tinha contraste suficiente com o fundo (${contrasteTexto.toFixed(1)}:1); ` +
            `troquei para ${legivel}.`,
        );
      }

      // Texto secundário vive sob o piso de 4.5:1 de propósito — ele é
      // secundário. 3:1 é o limite abaixo do qual deixa de ser leitura difícil
      // e passa a ser texto invisível.
      const contrasteMuted = contrastRatio(draft.colors.textMuted, draft.colors.surface);
      if (contrasteMuted < 3) {
        const legivel = mixToward(draft.colors.text, draft.colors.surface, 0.35);
        draft = { ...draft, colors: { ...draft.colors, textMuted: legivel } };
        adjustments.push(
          `A cor do texto secundário sumia no fundo (${contrasteMuted.toFixed(1)}:1); troquei para ${legivel}.`,
        );
      }

      // Vantagem/desvantagem só sinalizam se o texto colorido for legível
      // sobre a superfície — 3:1 é o piso de elemento gráfico da WCAG, o mesmo
      // usado para o secundário.
      for (const campo of ['success', 'danger'] as const) {
        const contraste = contrastRatio(draft.colors[campo], draft.colors.surface);
        if (contraste < 3) {
          const escurecido = mixToward(draft.colors[campo], '#000000', 0.3);
          draft = { ...draft, colors: { ...draft.colors, [campo]: escurecido } };
          adjustments.push(
            `A cor de ${campo === 'success' ? 'vantagem' : 'desvantagem'} sumia no fundo ` +
              `(${contraste.toFixed(1)}:1); escureci para ${escurecido}.`,
          );
        }
      }
    }

    const parsed = canonicalBrandIdentityV2Schema.safeParse(draft);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'A identidade resultante é inválida.', {
        httpStatus: 422,
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return { canonical: parsed.data, applied, rejected, adjustments };
  }
}

/**
 * Preto ou branco sobre a cor dada, pela luminância relativa (WCAG).
 *
 * Não é escolha estética: é a diferença entre a página pública ser legível e
 * não ser, e quem publica não tem como testar isso antes de alguém reclamar.
 */
export function readableOn(hex: string): string {
  return relativeLuminance(hex) > 0.179 ? '#111111' : '#ffffff';
}

function relativeLuminance(hex: string): number {
  const canal = (inicio: number): number => {
    const valor = Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/**
 * A razão de contraste entre duas cores (WCAG 2.1), de 1:1 a 21:1.
 *
 * É a mesma conta que uma ferramenta de acessibilidade faz, e serve para a
 * única pergunta que importa aqui: dá para ler? 4,5:1 é o piso do texto
 * corrido; abaixo de 3:1 não é mais leitura difícil, é texto invisível.
 */
export function contrastRatio(a: string, b: string): number {
  const claro = Math.max(relativeLuminance(a), relativeLuminance(b));
  const escuro = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (claro + 0.05) / (escuro + 0.05);
}

/** Aproxima `from` de `to` numa fração — usado para derivar um secundário legível. */
function mixToward(from: string, to: string, amount: number): string {
  const canal = (hex: string, inicio: number): number =>
    Number.parseInt(hex.slice(inicio, inicio + 2), 16);

  const componente = (inicio: number): string =>
    Math.round(canal(from, inicio) * (1 - amount) + canal(to, inicio) * amount)
      .toString(16)
      .padStart(2, '0');

  return `#${componente(1)}${componente(3)}${componente(5)}`;
}
