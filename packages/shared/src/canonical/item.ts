import { z } from 'zod';

/**
 * Item canônico (§5.1).
 *
 * Três identificadores, com papéis distintos — e a distinção importa:
 *
 *   `id`          ULID. Identidade TÉCNICA. Nunca muda, é o que o domínio usa
 *                 para localizar e mutar. Sobrevive a renomeações e reordenações.
 *   `code`        "CM01". Rótulo de UX. Derivado da faceta + ordinal; pode ser
 *                 renumerado sem consequência.
 *   `semanticKey` "communication.objectivity". Chave de DEDUPLICAÇÃO. É o que
 *                 impede que "seja objetivo" e "não explique demais" virem dois
 *                 itens: upsert com a mesma chave FUNDE no item existente.
 */

export const ENFORCEMENT_LEVELS = ['SOFT', 'HARD', 'DETERMINISTIC'] as const;
export type EnforcementLevel = (typeof ENFORCEMENT_LEVELS)[number];

/**
 * De onde o item veio — e a distinção que mais importa é a última.
 *
 *   USER              o usuário pediu explicitamente. Precedência máxima.
 *   MYAIHUB           o OS interpretou uma fala dele e estruturou.
 *   MYAIHUB_BASELINE  o OS INFERIU do papel pedido, sem o usuário citar.
 *   SYSTEM            veio da plataforma.
 *
 * Baseline inferida não é intenção explícita, e tratá-las igual apaga a
 * diferença entre "o MyAIHub achou que um representante comercial precisa saber
 * tratar objeção" e "o usuário mandou tratar objeção assim". Quando o usuário
 * depois contradiz a baseline, é a intenção dele que vence — e só dá para saber
 * qual é qual se a origem estiver gravada.
 */
export const CANONICAL_SOURCES = ['USER', 'MYAIHUB', 'MYAIHUB_BASELINE', 'SYSTEM'] as const;
export type CanonicalSource = (typeof CANONICAL_SOURCES)[number];

/** Item que o OS inferiu sozinho, sem o usuário ter pedido. */
export function isInferredBaseline(source: CanonicalSource): boolean {
  return source === 'MYAIHUB_BASELINE';
}

/** Referência a um checker do DeterministicRuleCheckRegistry (§6.1). */
export const ruleCheckRefSchema = z.object({
  name: z.string().min(1).max(60),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RuleCheckRef = z.infer<typeof ruleCheckRefSchema>;

export const canonicalItemSchema = z.object({
  id: z.string().min(1).max(40),
  code: z.string().min(2).max(10),
  semanticKey: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'semanticKey deve ser snake_case pontuado.'),
  label: z.string().min(1).max(80),
  /** Texto que o usuário lê. É a projeção humana do item, não a verdade. */
  statement: z.string().min(1).max(1200),
  enforcement: z.enum(ENFORCEMENT_LEVELS).default('SOFT'),
  check: ruleCheckRefSchema.optional(),
  source: z.enum(CANONICAL_SOURCES).default('MYAIHUB'),
  /**
   * Por que este item existe.
   *
   * Só faz sentido para baseline inferida: o usuário precisa poder perguntar
   * "por que tem isso aqui que eu não pedi?" e receber resposta.
   */
  rationale: z.string().max(300).optional(),
  /** Rastreia até a fala que originou o item. */
  originHubMessageId: z.string().max(40).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CanonicalItem = z.infer<typeof canonicalItemSchema>;

/**
 * Um item só pode carregar `check` quando é DETERMINISTIC, e todo
 * DETERMINISTIC precisa de um.
 *
 * Sem isso, "regra verificável em código" viraria um rótulo sem consequência —
 * exatamente o que o §8 do produto proíbe.
 */
export function assertEnforcementCoherent(item: CanonicalItem): void {
  if (item.enforcement === 'DETERMINISTIC' && !item.check) {
    throw new Error(
      `Item "${item.code}" é DETERMINISTIC mas não referencia um checker. ` +
        'Regra determinística sem verificação é só uma preferência com nome pomposo.',
    );
  }
  if (item.enforcement !== 'DETERMINISTIC' && item.check) {
    throw new Error(
      `Item "${item.code}" referencia um checker mas não é DETERMINISTIC. ` +
        'O checker nunca seria executado.',
    );
  }
}

/** Gera o `code` de exibição a partir do prefixo da faceta e da posição. */
export function buildCode(prefix: string, ordinal: number): string {
  return `${prefix}${String(ordinal).padStart(2, '0')}`;
}

/** Renumera os códigos de uma faceta preservando os ids técnicos. */
export function renumberCodes<T extends CanonicalItem>(prefix: string, items: T[]): T[] {
  return items.map((item, index) => ({ ...item, code: buildCode(prefix, index + 1) }));
}
