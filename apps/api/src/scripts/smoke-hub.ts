import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { ContextCompiler } from '../modules/ai/application/context-compiler.js';
import { parseModelRoute } from '../modules/ai/application/model-router.js';
import { PromptCompiler } from '../modules/ai/application/prompt-compiler.js';
import { GeminiProvider } from '../modules/ai/infrastructure/providers/gemini-provider.js';
import { ProjectProfileMutationApplier } from '../modules/myaihub/domain/mutation-applier.js';
import {
  CREATE_PROJECT_FROM_BRIEF,
  operationOutputSchema,
} from '../modules/myaihub/domain/operation.js';
import { validateRuleCheck } from '../modules/myaihub/domain/rule-checks.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from '../modules/myaihub/infrastructure/master-policy.seed.js';
import { PrismaPolicyRepository } from '../modules/myaihub/infrastructure/prisma-hub.repositories.js';
import { emptyProjectProfile } from '@myaihub/shared';

/**
 * Smoke test MANUAL do MyAIHub OS contra o modelo real.
 *
 * Responde a pergunta que nenhum teste com dublê responde: o modelo consegue
 * produzir mutações canônicas VÁLIDAS a partir de linguagem natural?
 *
 *   npm run smoke:hub -w @myaihub/api
 */
const BRIEF = [
  'Tenho a Easy, um marketplace onde prestadores de serviço autônomos — eletricistas,',
  'encanadores, diaristas — encontram clientes na região deles. Hoje eles dependem de',
  'indicação e ficam com a agenda vazia em semanas ruins. A gente cobra comissão só',
  'quando o serviço fecha, então não tem risco pra eles.',
].join(' ');

async function main(): Promise<void> {
  if (!env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY não configurada.');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const policies = new PrismaPolicyRepository(prisma as never);
  const policy = await policies.ensureSeeded(MASTER_POLICY_NAME, MASTER_POLICY_V1);

  const route = parseModelRoute(env.MODEL_ROLE_HUB_REASONING);
  const provider = new GeminiProvider(env.GEMINI_API_KEY);
  const operation = CREATE_PROJECT_FROM_BRIEF;

  console.log(`\nOperação: ${operation.name} · ${route.provider}:${route.model}`);
  console.log(`Policy v${policy.versionNumber}, seções: ${operation.policySections.join(', ')}\n`);
  console.log(`Briefing:\n"${BRIEF}"\n`);

  const context = new ContextCompiler().compile({
    tokenBudget: operation.tokenBudget,
    blocks: [
      ...operation.policySections
        .filter((section) => policy.sections[section])
        .map((section) => ({
          id: `policy.${section}`,
          kind: 'POLICY' as const,
          trust: 'TRUSTED' as const,
          priority: 100,
          cacheable: true,
          content: policy.sections[section]!,
        })),
      {
        id: 'operation.instruction',
        kind: 'POLICY' as const,
        trust: 'TRUSTED' as const,
        priority: 95,
        cacheable: true,
        content: operation.instruction,
      },
    ],
  });

  const request = new PromptCompiler().compile({
    context,
    model: route.model,
    params: { temperature: 0.3 },
    messages: [{ role: 'user', content: BRIEF }],
  });

  const result = await provider.generateStructured(request, operationOutputSchema);
  const output = result.content;

  console.log('--- intenção interpretada ---');
  console.log(output.interpretedIntent);
  console.log('\n--- raciocínio ---');
  console.log(output.rationale);
  console.log('\n--- resposta ao usuário ---');
  console.log(output.humanSummary);

  console.log(`\n--- ${output.mutations.length} mutações propostas ---`);
  for (const mutation of output.mutations) {
    const key = 'semanticKey' in mutation ? ` ${mutation.semanticKey}` : '';
    console.log(`  ${mutation.kind}${key}`);
  }

  if (output.gaps.length > 0) {
    console.log('\n--- lacunas identificadas (perguntas, não invenções) ---');
    for (const gap of output.gaps) console.log(`  · ${gap}`);
  }

  // O domínio valida e aplica — a LLM apenas propôs.
  const applied = new ProjectProfileMutationApplier().apply(
    emptyProjectProfile('Novo projeto'),
    output.mutations,
    {
      allowedMutations: operation.allowedMutations as never,
      now: new Date(),
      nextId: () => ulid(),
      source: 'USER',
      validateCheck: validateRuleCheck,
    },
  );

  console.log(`\n--- aplicadas pelo domínio: ${applied.applied.length} ---`);
  if (applied.rejected.length > 0) {
    console.log(`--- RECUSADAS: ${applied.rejected.length} ---`);
    for (const rejection of applied.rejected) {
      console.log(`  ✗ ${rejection.kind}: ${rejection.reason}`);
    }
  }

  console.log('\n--- perfil canônico resultante ---');
  console.log(`nome: ${applied.canonical.name}  ·  tipo: ${applied.canonical.type}`);
  console.log(`resumo: ${applied.canonical.summary}`);
  for (const facet of ['audiences', 'offerings', 'valuePropositions', 'differentiators'] as const) {
    for (const item of applied.canonical[facet]) {
      console.log(`  ${item.code} ${item.semanticKey}\n     ${item.label}: ${item.statement}`);
    }
  }

  console.log(
    `\ntokens: in ${result.usage.inputTokens} · out ${result.usage.outputTokens} · ${result.usage.latencyMs}ms`,
  );
  console.log(`\n${applied.rejected.length === 0 ? '✓' : '⚠'} MyAIHub OS operando.\n`);

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error('\n✗ smoke do OS falhou:\n', error);
  process.exitCode = 1;
});
