import type { RuleCheckRef } from '@myaihub/shared';
import { z } from 'zod';

/**
 * DeterministicRuleCheckRegistry (§6.1).
 *
 * Catálogo FECHADO de regras verificáveis mecanicamente. Custo zero, resultado
 * binário e explicável.
 *
 * A configuração canônica só pode referenciar um checker daqui, com params
 * validados pelo Zod do próprio checker. É isso que impede o banco de virar um
 * repositório de "regras em linguagem natural executáveis" — que não seriam
 * executáveis coisa nenhuma.
 */

export interface RuleViolation {
  check: string;
  message: string;
  evidence?: string;
}

export interface RuleCheck<TParams> {
  name: string;
  description: string;
  params: z.ZodType<TParams>;
  /** Devolve null quando a resposta está conforme. */
  run(response: string, params: TParams): RuleViolation | null;
}

function violation(check: string, message: string, evidence?: string): RuleViolation {
  return { check, message, ...(evidence ? { evidence } : {}) };
}

const maxQuestionsPerMessage: RuleCheck<{ max: number }> = {
  name: 'max_questions_per_message',
  description: 'Limita quantas perguntas o agente faz numa única mensagem.',
  params: z.object({ max: z.number().int().min(0).max(10) }),
  run(response, params) {
    // Conta '?' em vez de analisar sintaxe: é aproximado, mas é determinístico
    // e explicável — que é o ponto de uma regra determinística.
    const questions = (response.match(/\?/g) ?? []).length;
    if (questions <= params.max) return null;
    return violation(
      this.name,
      `A resposta faz ${questions} perguntas; o limite configurado é ${params.max}.`,
    );
  },
};

const maxMessageLength: RuleCheck<{ maxChars: number }> = {
  name: 'max_message_length',
  description: 'Limita o tamanho da resposta em caracteres.',
  params: z.object({ maxChars: z.number().int().min(50).max(20_000) }),
  run(response, params) {
    if (response.length <= params.maxChars) return null;
    return violation(
      this.name,
      `A resposta tem ${response.length} caracteres; o limite é ${params.maxChars}.`,
    );
  },
};

const mustNotMention: RuleCheck<{ terms: string[] }> = {
  name: 'must_not_mention',
  description: 'Proíbe termos específicos na resposta.',
  params: z.object({ terms: z.array(z.string().min(1).max(80)).min(1).max(50) }),
  run(response, params) {
    const normalized = response.toLowerCase();
    const found = params.terms.find((term) => normalized.includes(term.toLowerCase()));
    if (!found) return null;
    return violation(this.name, `A resposta menciona um termo proibido: "${found}".`, found);
  },
};

const forbidUrlsOutside: RuleCheck<{ allowedHosts: string[] }> = {
  name: 'forbid_urls_outside',
  description: 'Só permite links para hosts autorizados.',
  params: z.object({ allowedHosts: z.array(z.string().min(1).max(120)).max(50).default([]) }),
  run(response, params) {
    const urls = response.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
    const allowed = params.allowedHosts.map((host) => host.toLowerCase());

    for (const url of urls) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        // URL malformada não é violação desta regra; é ruído do modelo.
        continue;
      }
      const permitted = allowed.some((item) => host === item || host.endsWith(`.${item}`));
      if (!permitted) {
        return violation(
          this.name,
          `A resposta contém link para host não autorizado: ${host}.`,
          url,
        );
      }
    }
    return null;
  },
};

const requireLanguage: RuleCheck<{ language: 'pt' }> = {
  name: 'require_language',
  description: 'Exige que a resposta esteja no idioma configurado.',
  params: z.object({ language: z.literal('pt') }),
  run(response) {
    // Heurística barata: presença de marcadores do português. Suficiente para
    // pegar o caso real (modelo respondendo em inglês), sem custo de LLM.
    const markers = /\b(de|para|que|não|com|uma|você|está|então|porque)\b/i;
    if (markers.test(response) || response.trim().length < 20) return null;
    return violation(this.name, 'A resposta não parece estar em português.');
  },
};

const REGISTRY = new Map<string, RuleCheck<never>>(
  (
    [
      maxQuestionsPerMessage,
      maxMessageLength,
      mustNotMention,
      forbidUrlsOutside,
      requireLanguage,
    ] as unknown as Array<RuleCheck<never>>
  ).map((check) => [check.name, check]),
);

export const KNOWN_RULE_CHECKS: ReadonlySet<string> = new Set(REGISTRY.keys());

/**
 * Nomes válidos como tupla — é isto que vira `z.enum` no schema de saída da LLM.
 *
 * Sem a enum o modelo inventa nomes ("presence_check", "default") e o item
 * inteiro era descartado por causa de um campo acessório.
 */
export const RULE_CHECK_NAMES = [...REGISTRY.keys()] as [string, ...string[]];

export type RuleCheckValidation = { ok: true; check: RuleCheckRef } | { ok: false; reason: string };

/**
 * Valida nome E parâmetros contra o registry, devolvendo os params normalizados.
 *
 * Validar só o nome deixaria passar `{ name: 'max_questions_per_message' }` sem
 * `max`: um item marcado DETERMINISTIC cujo checker estoura na hora de rodar.
 */
export function validateRuleCheck(ref: RuleCheckRef): RuleCheckValidation {
  const check = getRuleCheck(ref.name);
  if (!check) {
    return {
      ok: false,
      reason: `o checker "${ref.name}" não existe (disponíveis: ${RULE_CHECK_NAMES.join(', ')})`,
    };
  }

  const params = check.params.safeParse(ref.params);
  if (!params.success) {
    return { ok: false, reason: `parâmetros inválidos para o checker "${ref.name}"` };
  }

  return { ok: true, check: { name: ref.name, params: params.data as Record<string, unknown> } };
}

/** Catálogo em texto, para a instrução da operação. */
export function describeRuleChecksForPrompt(): string {
  return [...REGISTRY.values()].map((check) => `- ${check.name}: ${check.description}`).join('\n');
}

export function getRuleCheck(name: string): RuleCheck<never> | undefined {
  return REGISTRY.get(name);
}

export function listRuleChecks(): Array<{ name: string; description: string }> {
  return [...REGISTRY.values()].map((check) => ({
    name: check.name,
    description: check.description,
  }));
}

/**
 * Roda os checkers determinísticos sobre uma resposta.
 *
 * Params inválidos NÃO são silenciados: um checker mal configurado que não roda
 * é indistinguível de um checker que aprovou.
 */
export function runDeterministicChecks(
  response: string,
  checks: Array<{ name: string; params: unknown }>,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const requested of checks) {
    const check = getRuleCheck(requested.name);
    if (!check) {
      violations.push(violation(requested.name, `Checker desconhecido: "${requested.name}".`));
      continue;
    }

    const params = check.params.safeParse(requested.params);
    if (!params.success) {
      violations.push(violation(requested.name, `Parâmetros inválidos para "${requested.name}".`));
      continue;
    }

    const result = check.run(response, params.data as never);
    if (result) violations.push(result);
  }

  return violations;
}
