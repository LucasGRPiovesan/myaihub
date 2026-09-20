import { AGENT_FACET_CODES, AGENT_FACET_LABELS, type AgentFacet } from './agent.js';
import type { CanonicalAgent } from './agent.js';

/**
 * Diagnóstico honesto do agente (§31).
 *
 * Função PURA sobre o documento canônico: nada aqui chama modelo. Perguntar ao
 * modelo "este agente está bom?" responderia diferente a cada vez, e um painel
 * de operação que muda de opinião sobre o mesmo dado é pior que nenhum painel.
 *
 * O número não é uma nota de vaidade. Ele existe para responder UMA pergunta —
 * "posso colocar isto no ar?" — e por isso cada ponto perdido vem com o que
 * fazer a respeito. Um medidor que só diz "72%" ensina o usuário a ignorá-lo.
 *
 * O que NÃO entra na conta, de propósito: quantidade. Um agente com trinta
 * itens vagos é pior que um com sete específicos, e premiar volume empurraria o
 * OS a multiplicar item — exatamente o que a policy proíbe.
 */

export type CheckStatus = 'ok' | 'warn' | 'missing';

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** O que está errado e o que fazer. Vazio quando está tudo certo. */
  detail: string;
  /** Peso na nota. Nem tudo pesa igual: sem objetivo o agente não funciona. */
  weight: number;
}

export interface AgentHealth {
  /** 0–100. Arredondado, sem casas — precisão falsa é ruído. */
  score: number;
  checks: HealthCheck[];
  /** Quantos itens o agente tem, somando as facetas. */
  items: number;
  /**
   * Pode ir para o ar?
   *
   * Verdadeiro só quando nenhum check essencial está `missing`. É uma pergunta
   * binária e não deve ser derivada de um limiar arbitrário sobre a nota.
   */
  publishable: boolean;
}

/** Um `statement` curto demais não configurou nada — só repetiu o rótulo. */
const THIN_STATEMENT = 60;

const ESSENTIAL = new Set(['objective', 'identity', 'limits']);

export function assessAgent(agent: CanonicalAgent): AgentHealth {
  const facets = Object.keys(AGENT_FACET_CODES) as AgentFacet[];
  const items = facets.reduce((total, facet) => total + agent[facet].length, 0);
  const checks: HealthCheck[] = [];

  checks.push({
    id: 'identity',
    label: 'Identidade',
    weight: 10,
    ...(agent.identity.name && agent.identity.role
      ? { status: 'ok' as const, detail: '' }
      : {
          status: 'missing' as const,
          detail: 'Sem nome ou papel definido, o agente não sabe quem está sendo.',
        }),
  });

  checks.push({
    id: 'objective',
    label: 'Objetivo',
    weight: 20,
    ...(agent.objective.primary
      ? { status: 'ok' as const, detail: '' }
      : {
          status: 'missing' as const,
          detail: 'Sem objetivo ele conversa sem chegar a lugar nenhum.',
        }),
  });

  checks.push({
    id: 'limits',
    label: 'Limites',
    weight: 20,
    ...(agent.limits.length > 0
      ? { status: 'ok' as const, detail: '' }
      : {
          status: 'missing' as const,
          detail: 'Nada impede que ele prometa o que a empresa não cumpre.',
        }),
  });

  // Uma faceta vazia não é erro — é escolha. Muitas vazias significam que a
  // baseline não pegou, e aí o agente responde genérico.
  const empty = facets.filter((facet) => agent[facet].length === 0);
  checks.push({
    id: 'coverage',
    label: 'Cobertura',
    weight: 15,
    ...(empty.length <= 1
      ? { status: 'ok' as const, detail: '' }
      : empty.length <= 3
        ? {
            status: 'warn' as const,
            detail: `Sem nada em ${empty.map((facet) => AGENT_FACET_LABELS[facet].toLowerCase()).join(', ')}.`,
          }
        : {
            status: 'missing' as const,
            detail: `${empty.length} de ${facets.length} seções vazias — ele vai responder genérico.`,
          }),
  });

  // O item precisa CARREGAR a implicação. "Seja objetivo" gravado como frase de
  // duas palavras entrega ao modelo um adjetivo e deixa ele decidir sozinho.
  const thin = facets.flatMap((facet) =>
    agent[facet].filter((item) => item.statement.length < THIN_STATEMENT),
  );
  checks.push({
    id: 'depth',
    label: 'Profundidade',
    weight: 15,
    ...(thin.length === 0
      ? { status: 'ok' as const, detail: '' }
      : {
          status: thin.length > items / 3 ? ('missing' as const) : ('warn' as const),
          detail: `${thin.length} ${thin.length === 1 ? 'item diz' : 'itens dizem'} pouco: ${thin
            .slice(0, 3)
            .map((item) => item.code)
            .join(', ')}. Em execução isso vira interpretação livre do modelo.`,
        }),
  });

  // Regra "verificada em código" só é verdade se houver checker. É o que
  // separa uma promessa auditável de uma instrução torcendo para dar certo.
  const verified = [...agent.hardRules, ...agent.limits].filter((item) => item.check).length;
  checks.push({
    id: 'verifiable',
    label: 'Regras verificáveis',
    weight: 10,
    ...(verified > 0
      ? { status: 'ok' as const, detail: '' }
      : {
          status: 'warn' as const,
          detail: 'Nenhuma regra é conferida em código — todas dependem do modelo obedecer.',
        }),
  });

  checks.push({
    id: 'engagement',
    label: 'Abertura',
    weight: 10,
    status: 'ok',
    detail: '',
  });

  // Abrir sem roteiro NÃO é defeito: é o caso comum, e o correto na maioria
  // das vezes. O que merece aviso é abrir sem roteiro E sem diretriz — aí a
  // primeira frase, que é a parte do agente mais vista, sai de lugar nenhum.
  if (agent.engagement.initiator === 'AGENT') {
    const opening = checks[checks.length - 1]!;
    if (agent.engagement.openerMode === 'SCRIPTED') {
      opening.detail = agent.engagement.opener ? 'Abre sempre com a mesma frase.' : '';
    } else if (!agent.engagement.openerGuidance) {
      opening.status = 'warn';
      opening.detail =
        'Ele abre a conversa, mas nada orienta a primeira frase — ela sai diferente a cada vez, sem critério.';
    }
  }

  const earned = checks.reduce(
    (total, check) =>
      total + check.weight * (check.status === 'ok' ? 1 : check.status === 'warn' ? 0.5 : 0),
    0,
  );
  const possible = checks.reduce((total, check) => total + check.weight, 0);

  return {
    score: Math.round((earned / possible) * 100),
    checks,
    items,
    publishable: !checks.some((check) => ESSENTIAL.has(check.id) && check.status === 'missing'),
  };
}
