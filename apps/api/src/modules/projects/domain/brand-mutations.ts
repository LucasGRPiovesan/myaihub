import { BRAND_SHAPES, BRAND_VOICE_TONES, FONT_SOURCES } from '@myaihub/shared';
import { z } from 'zod';

/**
 * Mutação da identidade de marca (Fase 5).
 *
 * SINGLETON, como `SET_AGENT_ENGAGEMENT`: identidade visual não é lista de
 * itens. Cor não tem `semanticKey` nem `enforcement`, e inventar isso para ela
 * caber no formato das outras facetas produziria um vocabulário que ninguém
 * consegue usar — o OS acabaria criando um "item" por cor.
 *
 * Todo campo é OPCIONAL e o aplicador faz merge: um pedido para trocar só a cor
 * não pode apagar o rodapé legal. Documento inteiro de volta é justamente o que
 * já custou um princípio perdido no playbook.
 */

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/);

export const BRAND_MUTATION_KINDS = ['SET_BRAND_IDENTITY'] as const;
export type BrandMutationKind = (typeof BRAND_MUTATION_KINDS)[number];

export const brandMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SET_BRAND_IDENTITY'),
    displayName: z.string().trim().max(80).optional(),
    tagline: z.string().trim().max(160).optional(),
    primaryColor: hexColor.optional(),
    onPrimaryColor: hexColor.optional(),
    canvasColor: hexColor.optional(),
    surfaceColor: hexColor.optional(),
    textColor: hexColor.optional(),
    textMutedColor: hexColor.optional(),
    borderColor: hexColor.optional(),
    /** Vantagem/desvantagem num comparativo — psicologia da cor DENTRO da marca. */
    successColor: hexColor.optional(),
    dangerColor: hexColor.optional(),
    /**
     * A fonte é o NOME da família, nunca uma URL.
     *
     * O mesmo charset do canônico: é ele que impede um nome vindo do site de
     * terceiro — ou escrito pelo modelo que leu esse site — de virar qualquer
     * coisa além de uma família dentro da query do provedor de fontes.
     */
    headingFamily: z
      .string()
      .trim()
      .max(48)
      .regex(/^[A-Za-z0-9 -]*$/)
      .optional(),
    bodyFamily: z
      .string()
      .trim()
      .max(48)
      .regex(/^[A-Za-z0-9 -]*$/)
      .optional(),
    fontSource: z.enum(FONT_SOURCES).optional(),
    shape: z.enum(BRAND_SHAPES).optional(),
    logoAssetId: z.string().max(40).nullable().optional(),
    avatarAssetId: z.string().max(40).nullable().optional(),
    tone: z.enum(BRAND_VOICE_TONES).optional(),
    voiceGuidance: z.string().trim().max(600).optional(),
    /** Substitui a lista inteira — é curta e o usuário a pensa como conjunto. */
    avoid: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    legalFooter: z.string().trim().max(400).optional(),
  }),
]);

export type BrandMutation = z.infer<typeof brandMutationSchema>;
