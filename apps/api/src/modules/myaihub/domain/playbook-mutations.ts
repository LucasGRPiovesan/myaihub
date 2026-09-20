import { z } from 'zod';
import {
  PLACEHOLDER_PLAYBOOK_KEY as PLACEHOLDER_KEY,
  type AgentPlaybook,
  type PlaybookFacet,
} from '@myaihub/shared';

/**
 * Mutações tipadas do playbook.
 *
 * Existem pelo mesmo motivo que as do agente: o OS NUNCA reescreve o documento
 * inteiro. Ele analisa o pedido, localiza o que precisa mudar e devolve só as
 * alterações — que podem ser várias, em seções diferentes, mas nunca "aqui está
 * o playbook novo".
 *
 * A versão anterior desta funcionalidade pedia o documento completo de volta e
 * dependia de o modelo copiar o resto palavra por palavra. Funcionou na medição
 * (14 de 15 princípios preservados), e é justamente esse "14 de 15" que mostra o
 * problema: um item se perdeu, e ninguém teria como saber qual. Num playbook que
 * é o piso de todo agente daquele papel, em toda conta, isso não é aceitável.
 *
 * Com mutação tipada o item que ninguém mencionou não passa nem perto do
 * modelo — ele fica onde está, byte por byte.
 */

/** Identidade estável do item, no mesmo formato do resto do canônico (§5.1). */
const semanticKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'Use minúsculas, ponto e underscore.')
  .max(80);

const facetSchema = z.enum([
  'personality',
  'communication',
  'skills',
  'behaviors',
  'strategies',
  'hardRules',
]);

export const playbookMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SET_PLAYBOOK_IDENTITY'),
    /**
     * Só na CRIAÇÃO. Num ofício que já existe a chave é imutável — ver o
     * aplicador: ela é a proveniência gravada em todo agente daquele papel.
     */
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
      .max(60)
      .optional(),
    label: z.string().trim().min(3).max(80).optional(),
    thesis: z.string().trim().min(20).max(600).optional(),
  }),
  z.object({
    kind: z.literal('UPSERT_PRINCIPLE'),
    /** Reutilizar a chave REFINA o princípio; uma nova cria. */
    semanticKey: semanticKeySchema,
    facet: facetSchema,
    label: z.string().trim().min(3).max(80),
    statement: z.string().trim().min(20).max(700),
    /**
     * Orientação ou PROIBIÇÃO.
     *
     * O vocabulário não tinha este campo, e a consequência era concreta: todo
     * princípio que o OS escrevia nascia SOFT, ou seja, preferência. No prompt
     * do agente, SOFT fica no meio da lista da faceta e HARD sobe para o bloco
     * "REGRAS INEGOCIÁVEIS" — então "é proibido supor" chegava com o mesmo peso
     * de "prefira ir devagar", e o OS não tinha como corrigir isso nem quando
     * percebia. Medido: nove versões seguidas do mesmo princípio, todas SOFT,
     * nenhuma efetiva.
     */
    enforcement: z.enum(['SOFT', 'HARD']).optional(),
  }),
  z.object({ kind: z.literal('REMOVE_PRINCIPLE'), semanticKey: semanticKeySchema }),
  z.object({
    kind: z.literal('UPSERT_LIMIT'),
    semanticKey: semanticKeySchema,
    label: z.string().trim().min(3).max(80),
    statement: z.string().trim().min(10).max(400),
  }),
  z.object({ kind: z.literal('REMOVE_LIMIT'), semanticKey: semanticKeySchema }),
  z.object({
    kind: z.literal('UPSERT_QUESTION'),
    semanticKey: semanticKeySchema,
    question: z.string().trim().min(5).max(160),
    why: z.string().trim().min(5).max(200),
    placeholder: z.string().trim().max(120).default(''),
  }),
  z.object({ kind: z.literal('REMOVE_QUESTION'), semanticKey: semanticKeySchema }),
  // Listas curtas de texto puro: substituir a lista É a alteração cirúrgica,
  // porque a lista inteira cabe em cinco linhas e não tem identidade por item.
  z.object({
    kind: z.literal('SET_RECOGNITION'),
    appliesTo: z.array(z.string().trim().min(3).max(120)).min(1).max(12),
  }),
  z.object({
    kind: z.literal('SET_ALREADY_ANSWERED'),
    items: z.array(z.string().trim().min(5).max(200)).max(15),
  }),
  z.object({
    kind: z.literal('SET_SOURCES'),
    items: z.array(z.string().trim().min(3).max(300)).max(20),
  }),
]);

export type PlaybookMutation = z.infer<typeof playbookMutationSchema>;
export type PlaybookMutationKind = PlaybookMutation['kind'];

export const ALL_PLAYBOOK_MUTATIONS: readonly PlaybookMutationKind[] = [
  'SET_PLAYBOOK_IDENTITY',
  'UPSERT_PRINCIPLE',
  'REMOVE_PRINCIPLE',
  'UPSERT_LIMIT',
  'REMOVE_LIMIT',
  'UPSERT_QUESTION',
  'REMOVE_QUESTION',
  'SET_RECOGNITION',
  'SET_ALREADY_ANSWERED',
  'SET_SOURCES',
];

/** Códigos curtos e estáveis por seção — é o que o admin cita e o painel exibe. */
const CODE_PREFIX = { principles: 'PR', antiPatterns: 'LM', worthAsking: 'PG' } as const;

function nextCode(prefix: string, taken: Set<string>): string {
  for (let index = 1; index < 1000; index += 1) {
    const code = `${prefix}${String(index).padStart(2, '0')}`;
    if (!taken.has(code)) return code;
  }
  // Inalcançável na prática; melhor um código feio que um item sem identidade.
  return `${prefix}${Date.now().toString(36).toUpperCase()}`;
}

export interface PlaybookApplyResult {
  playbook: AgentPlaybook;
  applied: PlaybookMutation[];
  rejected: Array<{ kind: string; reason: string }>;
  adjustments: string[];
}

/**
 * Aplica as mutações sobre o playbook.
 *
 * Toda seção que nenhuma mutação toca sai IDÊNTICA — é a garantia que o
 * documento inteiro devolvido pelo modelo não conseguia dar.
 */
export function applyPlaybookMutations(
  current: AgentPlaybook,
  mutations: PlaybookMutation[],
  allowed: readonly PlaybookMutationKind[],
): PlaybookApplyResult {
  const next: AgentPlaybook = structuredClone(current);
  const applied: PlaybookMutation[] = [];
  const rejected: Array<{ kind: string; reason: string }> = [];
  const adjustments: string[] = [];

  const codesOf = (section: 'principles' | 'antiPatterns' | 'worthAsking'): Set<string> =>
    new Set(next[section].map((item) => item.code));

  for (const mutation of mutations) {
    if (!allowed.includes(mutation.kind)) {
      rejected.push({ kind: mutation.kind, reason: 'fora do escopo desta operação' });
      continue;
    }

    switch (mutation.kind) {
      case 'SET_PLAYBOOK_IDENTITY': {
        if (mutation.label) next.label = mutation.label;
        if (mutation.thesis) next.thesis = mutation.thesis;

        // A CHAVE só entra num ofício que ainda não tem endereço.
        //
        // Renomear a chave de um playbook existente órfãozaria a proveniência:
        // todo agente daquele papel carrega `playbookKey`, e é por ela que o
        // refinamento acontece com o ofício certo. O agente não some — ele
        // passa a apontar para um ofício que não existe, em silêncio.
        if (mutation.key) {
          if (next.key === PLACEHOLDER_KEY) {
            next.key = mutation.key;
          } else if (mutation.key !== next.key) {
            adjustments.push(
              `A chave de um ofício não muda (${next.key}): ela é a proveniência ` +
                `gravada em todo agente deste papel. Ignorei "${mutation.key}".`,
            );
          }
        }

        break;
      }

      case 'UPSERT_PRINCIPLE': {
        const found = next.principles.find((item) => item.semanticKey === mutation.semanticKey);
        if (found) {
          if (found.facet !== mutation.facet) {
            adjustments.push(
              `"${found.label}" mudou de ${found.facet} para ${mutation.facet}: o alvo por faceta muda junto.`,
            );
          }
          found.facet = mutation.facet;
          found.label = mutation.label;

          // REFINAR NÃO PODE ENCOLHER — nem no playbook.
          //
          // O agente já tinha essa garantia (`guardAgainstRegression`); o
          // playbook não, e ele é o PISO de todo agente futuro daquele papel.
          // Perder precisão aqui é pior: o agente perde para um usuário, o
          // playbook perde para todos os que ainda vão nascer.
          //
          // Medido: um princípio curado de 682 caracteres — com a cláusula que
          // fazia a regra funcionar na prática — voltou do modelo com 433 e a
          // cláusula fora. A versão curta parecia uma correção legítima.
          //
          // A margem de 15% é a mesma do agente: acomoda reescrita que ficou um
          // pouco mais enxuta, barra a que jogou fora metade.
          if (mutation.statement.length < found.statement.length * 0.85) {
            adjustments.push(
              `"${found.label}" perderia detalhe (${found.statement.length} → ${mutation.statement.length} caracteres); mantive o texto anterior.`,
            );
          } else {
            found.statement = mutation.statement;
          }
          // Omitir o campo mantém o que estava: refinar o TEXTO não é motivo
          // para rebaixar uma proibição que alguém já tinha marcado.
          if (mutation.enforcement) found.enforcement = mutation.enforcement;
        } else {
          next.principles.push({
            code: nextCode(CODE_PREFIX.principles, codesOf('principles')),
            semanticKey: mutation.semanticKey,
            facet: mutation.facet as PlaybookFacet,
            label: mutation.label,
            statement: mutation.statement,
            ...(mutation.enforcement ? { enforcement: mutation.enforcement } : {}),
          });
        }
        break;
      }

      case 'REMOVE_PRINCIPLE': {
        const before = next.principles.length;
        next.principles = next.principles.filter(
          (item) => item.semanticKey !== mutation.semanticKey,
        );
        if (next.principles.length === before) {
          rejected.push({ kind: mutation.kind, reason: `${mutation.semanticKey} não existe` });
          continue;
        }
        break;
      }

      case 'UPSERT_LIMIT': {
        const found = next.antiPatterns.find((item) => item.semanticKey === mutation.semanticKey);
        if (found) {
          found.label = mutation.label;
          found.statement = mutation.statement;
        } else {
          next.antiPatterns.push({
            code: nextCode(CODE_PREFIX.antiPatterns, codesOf('antiPatterns')),
            semanticKey: mutation.semanticKey,
            label: mutation.label,
            statement: mutation.statement,
          });
        }
        break;
      }

      case 'REMOVE_LIMIT': {
        const before = next.antiPatterns.length;
        next.antiPatterns = next.antiPatterns.filter(
          (item) => item.semanticKey !== mutation.semanticKey,
        );
        if (next.antiPatterns.length === before) {
          rejected.push({ kind: mutation.kind, reason: `${mutation.semanticKey} não existe` });
          continue;
        }
        break;
      }

      case 'UPSERT_QUESTION': {
        const found = next.worthAsking.find((item) => item.semanticKey === mutation.semanticKey);
        if (found) {
          found.question = mutation.question;
          found.why = mutation.why;
          found.placeholder = mutation.placeholder;
        } else {
          next.worthAsking.push({
            code: nextCode(CODE_PREFIX.worthAsking, codesOf('worthAsking')),
            semanticKey: mutation.semanticKey,
            question: mutation.question,
            why: mutation.why,
            placeholder: mutation.placeholder,
          });
        }
        break;
      }

      case 'REMOVE_QUESTION': {
        const before = next.worthAsking.length;
        next.worthAsking = next.worthAsking.filter(
          (item) => item.semanticKey !== mutation.semanticKey,
        );
        if (next.worthAsking.length === before) {
          rejected.push({ kind: mutation.kind, reason: `${mutation.semanticKey} não existe` });
          continue;
        }
        break;
      }

      case 'SET_RECOGNITION': {
        next.appliesTo = mutation.appliesTo;
        break;
      }

      case 'SET_ALREADY_ANSWERED': {
        next.alreadyAnswered = mutation.items;
        break;
      }

      case 'SET_SOURCES': {
        next.sources = mutation.items;
        break;
      }
    }

    applied.push(mutation);
  }

  return { playbook: next, applied, rejected, adjustments };
}
