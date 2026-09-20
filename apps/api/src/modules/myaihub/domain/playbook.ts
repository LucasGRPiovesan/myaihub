import { z } from 'zod';
import { agentPlaybookSchema, CORE_PLAYBOOK_KEY, type AgentPlaybook } from '@myaihub/shared';

/**
 * Helpers de PROMPT do playbook.
 *
 * O contrato (schema e tipos) mora em `@myaihub/shared` porque a tela do admin
 * edita exatamente estes campos: tipo duplicado nos dois lados diverge, e o
 * sintoma é a tela dizer "salvo" enquanto a API devolve 422.
 */
export { agentPlaybookSchema, CORE_PLAYBOOK_KEY };
export type {
  PlaybookFacet,
  PlaybookPrinciple,
  PlaybookLimit,
  PlaybookQuestion,
} from '@myaihub/shared';
export type { AgentPlaybook };
void z;

/** O catálogo, como o classificador o enxerga. Só o suficiente para escolher. */
export interface PlaybookCatalogEntry {
  key: string;
  label: string;
  appliesTo: string[];
}

export function toCatalogEntry(playbook: AgentPlaybook): PlaybookCatalogEntry {
  return { key: playbook.key, label: playbook.label, appliesTo: playbook.appliesTo };
}

/**
 * O catálogo em texto, para o modelo escolher uma chave.
 *
 * Vai no MESMO turno que já planeja o briefing: classificar é barato, e uma
 * chamada só para isso seria custo por nada.
 */
export function describeCatalogForPrompt(entries: PlaybookCatalogEntry[]): string {
  if (entries.length === 0) return '(nenhum playbook cadastrado)';

  return entries
    .map(
      (entry) => `  ${entry.key} — ${entry.label}\n    aplica-se a: ${entry.appliesTo.join('; ')}`,
    )
    .join('\n');
}

/**
 * O playbook como bloco de contexto da operação de projeto.
 *
 * Ordem deliberada: tese primeiro (é o que orienta tudo), princípios no meio,
 * anti-padrões por último — o fim do bloco é o que o modelo mais retém, e
 * anti-padrão errado é o que produz o agente que o usuário rejeita.
 */
const FACET_LABEL: Record<string, string> = {
  personality: 'PERSONALIDADE — como o agente É',
  communication: 'COMUNICAÇÃO — como ele SE COMUNICA',
  skills: 'SKILLS — o que ele SABE FAZER',
  behaviors: 'COMPORTAMENTOS — como ele AGE',
  strategies: 'ESTRATÉGIAS — abordagens disponíveis',
  hardRules: 'REGRAS DURAS — obrigações inegociáveis',
};

export function compilePlaybookForPrompt(playbooks: AgentPlaybook[]): string {
  const applicable = playbooks.filter((item) => item.principles.length > 0);
  if (applicable.length === 0) return '';

  // O alvo por faceta SOMA os playbooks aplicáveis. Contá-los separado faria a
  // conduta universal disputar cota com o ofício — e perder, que foi o que
  // aconteceu: o agente saía sem espelhar o registro de quem falava com ele.
  const byFacet = new Map<string, string[]>();
  for (const playbook of applicable) {
    for (const principle of playbook.principles) {
      const list = byFacet.get(principle.facet) ?? [];
      list.push(principle.statement);
      byFacet.set(principle.facet, list);
    }
  }

  const principleCount = applicable.reduce((sum, item) => sum + item.principles.length, 0);
  const antiPatterns = applicable.flatMap((item) => item.antiPatterns);
  const label = applicable.map((item) => item.label).join(' + ');

  const target = [...byFacet.entries()]
    .map(([facet, items]) => `${facet} ${items.length}`)
    .join(' · ');

  const lines = [
    `PLAYBOOK DE OFÍCIO — ${label}`,
    '',
    'Isto é a baseline profissional deste papel: o que um excelente profissional',
    'da área faz, destilado de pesquisa. É PISO, não teto, e não substitui o que',
    'o usuário pediu — quando ele contradiz o playbook, a intenção dele vence.',
    '',
    ...applicable.map((item) => `TESE: ${item.thesis}`),
    '',
    `PRINCÍPIOS (${principleCount}) — cada um vira UM item canônico, na`,
    'faceta em que está listado. Não copie o texto: reescreva-o como a instrução',
    'que o agente vai receber em execução, no vocabulário do negócio dele.',
    '',
    `ALVO POR FACETA, e ele é conferível: ${target}.`,
    'Este alvo é PISO, não teto. Some a ele o que a conduta baseline exige de',
    'todo agente e o que o usuário pediu neste briefing — faceta que não aparece',
    'na lista acima continua precisando dos itens dela.',
    'A cobertura mínima da instrução NÃO vale aqui — ela é para quando não há',
    'playbook, e usá-la como referência joga fora exatamente o que este playbook',
    'tem de melhor. Funda dois princípios só se forem o mesmo conceito.',
    '',
    'Marque estes itens como baseline inferida e escreva em `rationale` que vêm da',
    'prática profissional do papel — o usuário tem direito de saber por que estão lá.',
    '',
    ...[...byFacet.entries()].flatMap(([facet, items]) => [
      `${FACET_LABEL[facet] ?? facet} (${items.length})`,
      ...items.map((item, index) => `  ${index + 1}. ${item}`),
      '',
    ]),
  ];

  if (antiPatterns.length > 0) {
    lines.push(
      '',
      `LIMITES (${antiPatterns.length}) — cada um vira UM limite, com o mesmo`,
      'peso dos princípios. Um agente sem as proteções do próprio ofício é o agente',
      'que o usuário devolve depois do primeiro teste.',
      '',
      ...antiPatterns.map((item) => `  · ${item.statement}`),
    );
  }

  return lines.join('\n');
}
