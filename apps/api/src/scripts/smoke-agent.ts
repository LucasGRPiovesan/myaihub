import type { CanonicalAgent } from '@myaihub/shared';
import { env } from '../config/env.js';
import { createContainer } from '../container.js';
import { CREATE_AGENT } from '../modules/myaihub/domain/agent-operations.js';
import { systemTenantContext } from '../shared/application/tenant-context.js';
import { getDb } from '../shared/infrastructure/prisma/client.js';

/**
 * Smoke MANUAL da criação de agente, contra o modelo real.
 *
 * A pergunta que ele responde: o playbook de ofício chegou ao agente? Um teste
 * com dublê prova que o bloco foi montado; só o modelo real prova que o agente
 * NASCE sabendo diagnosticar antes de propor — que era o defeito relatado.
 */
const BRIEFING = [
  'Quero um Representante Comercial Estratégico.',
  'Setor: plataforma de prestação de serviços para autônomos.',
  'Canal: WhatsApp, a pessoa chega de anúncio.',
  'Quem começa a conversa é o AGENTE: ele puxa o assunto sozinho.',
].join('\n');

/** O que o playbook precisa ter produzido. Busca por CONCEITO, não por frase. */
const EXPECTED: Array<{ label: string; probes: string[] }> = [
  {
    label: 'diagnóstico antes de propor',
    probes: ['diagnóst', 'antes de propor', 'antes de apresentar', 'descobr'],
  },
  {
    label: 'não pressionar / preservar autonomia',
    probes: ['pressão', 'pressionar', 'autonomia', 'insistir'],
  },
  {
    label: 'não inventar preço/condição',
    probes: ['inventar', 'não estejam no contexto', 'preço'],
  },
  { label: 'escassez falsa proibida', probes: ['escassez', 'urgência'] },
  {
    label: 'adapta o registro ao interlocutor',
    probes: ['formalidade', 'registro', 'espelh', 'adapta'],
  },
];

function allStatements(agent: CanonicalAgent): string {
  const facets = [
    agent.personality,
    agent.communication,
    agent.skills,
    agent.behaviors,
    agent.strategies,
    agent.hardRules,
    agent.limits,
  ];
  return facets
    .flat()
    .map((item) => `${item.label} ${item.statement}`)
    .join('\n')
    .toLowerCase();
}

async function main(): Promise<void> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');

  const container = createContainer();
  const db = getDb();
  const account = await db.account.findFirstOrThrow();
  const user = await db.user.findFirstOrThrow();
  const context = {
    ...systemTenantContext('smoke:agent'),
    accountId: account.id,
    userId: user.id,
  };

  const conversation = await container.hub.conversations.create(context, {
    id: container.hub.ids.generate(),
    scope: 'ROOT',
    scopeId: null,
    title: 'smoke',
  });

  const started = Date.now();
  const result = await container.hub.runner.run(context, {
    conversationId: conversation.id,
    operation: CREATE_AGENT,
    userMessage: BRIEFING,
    playbookKey: 'sales.consultive',
  });

  console.log(`\ncriado em ${Date.now() - started}ms · ${result.totalTokens} tokens`);
  console.log(result.humanSummary);

  const found = await container.agents.agents.findById(context, result.entityId!);
  const agent = found?.version?.canonicalConfig;
  if (!agent) throw new Error('agente sem configuração');

  console.log(`\nplaybookKey gravado: ${agent.playbookKey || '(vazio)'}`);
  console.log(
    `itens: personalidade ${agent.personality.length} · comunicação ${agent.communication.length} · ` +
      `skills ${agent.skills.length} · comportamentos ${agent.behaviors.length} · ` +
      `estratégias ${agent.strategies.length} · regras ${agent.hardRules.length} · ` +
      `limites ${agent.limits.length}`,
  );

  const haystack = allStatements(agent);
  console.log('\nofício presente na configuração:');
  for (const check of EXPECTED) {
    const hit = check.probes.some((probe) => haystack.includes(probe));
    console.log(`  ${hit ? 'OK  ' : 'FALTA'} ${check.label}`);
  }

  console.log('\n--- configuração completa ---');
  const every = [
    ...agent.personality,
    ...agent.communication,
    ...agent.skills,
    ...agent.behaviors,
    ...agent.strategies,
    ...agent.hardRules,
    ...agent.limits,
  ];
  for (const item of every) {
    console.log(`· [${item.code}] ${item.label}: ${item.statement.slice(0, 180)}`);
  }

  // A configuração pode estar linda e a CONVERSA continuar ruim. O defeito
  // relatado era de runtime — "ele age como vendedor desesperado" —, então a
  // prova final é falar com ele.
  const scenario = [
    'Plataforma Easy, que conecta prestadores de serviço autônomos a clientes da região.',
    'A pessoa chegou pelo WhatsApp depois de ver um anúncio. Ainda não é cliente.',
  ].join(' ');

  console.log('\n--- conversa de teste ---');
  const opening = await container.agents.testAgent.open(context, result.entityId!, { scenario });
  console.log(`AGENTE: ${opening.reply}`);

  // A conversa é do SERVIDOR agora (Fase 8): o script guarda o `sessionId`, não
  // o transcrito. Continuar mandando histórico daqui testaria um caminho que a
  // aplicação não usa mais.
  const sessionId = opening.sessionId;

  for (const message of [
    'oi, vi o anuncio. como funciona?',
    'quanto custa?',
    'sei la, to meio sem tempo pra isso agora',
  ]) {
    console.log(`\nPESSOA: ${message}`);
    const turn = await container.agents.testAgent.execute(context, {
      agentId: result.entityId!,
      scenario,
      sessionId,
      message,
    });
    console.log(`AGENTE: ${turn.reply}`);
  }

  process.exit(0);
}

void main();
