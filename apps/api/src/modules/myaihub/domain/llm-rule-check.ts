import type { RuleCheckRef } from '@myaihub/shared';
import { z } from 'zod';
import { RULE_CHECK_NAMES } from './rule-checks.js';

/**
 * Projeção do `RuleCheckRef` para o schema de saída da LLM (§6.1).
 *
 * Duas diferenças em relação ao `ruleCheckRefSchema` canônico, ambas por
 * limitação medida do provider:
 *
 * 1. `name` é ENUM do registry, não string livre. O modelo inventava nomes
 *    ("presence_check", "default") e o item era descartado inteiro.
 * 2. `params` é um objeto PLANO de campos opcionais, não `Record<string,
 *    unknown>`. O Gemini não aceita `additionalProperties`, então um mapa
 *    aberto chegava vazio — e um checker sem params não roda.
 *
 * Os campos são a união dos params dos checkers registrados. Cada checker
 * valida o que lhe interessa (`z.object` descarta o resto), então o objeto
 * plano converte direto para o `params` canônico.
 */
/** Nome que o parser aceita quando o modelo inventa um checker fora do registry. */
export const UNKNOWN_RULE_CHECK = 'checker_desconhecido';

export const llmRuleCheckSchema = z.object({
  // A enum ORIENTA (vai para o JSON Schema do provider), o `.catch` PERDOA: um
  // nome inventado num item não pode invalidar a resposta inteira e derrubar as
  // outras cinco mutações junto. Cai no sentinela e o domínio rebaixa o item.
  name: z.enum(RULE_CHECK_NAMES).catch(UNKNOWN_RULE_CHECK),
  params: z
    .object({
      /** max_questions_per_message */
      max: z.number().int().min(0).max(10).optional(),
      /** max_message_length */
      maxChars: z.number().int().min(50).max(20_000).optional(),
      /** must_not_mention */
      terms: z.array(z.string().min(1).max(80)).max(50).optional(),
      /** forbid_urls_outside */
      allowedHosts: z.array(z.string().min(1).max(120)).max(50).optional(),
      /** require_language */
      language: z.literal('pt').optional(),
    })
    .default({}),
});

export type LlmRuleCheck = z.infer<typeof llmRuleCheckSchema>;

/** Descarta os campos ausentes: `undefined` explícito falharia o zod do checker. */
export function toRuleCheckRef(check: LlmRuleCheck): RuleCheckRef {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(check.params)) {
    if (value !== undefined) params[key] = value;
  }
  return { name: check.name, params };
}
