import { env } from '../config/env.js';
import { createContainer } from '../container.js';
import {
  MASTER_POLICY_NAME,
  MASTER_POLICY_V1,
} from '../modules/myaihub/infrastructure/master-policy.seed.js';
import { getDb } from '../shared/infrastructure/prisma/client.js';
import { systemTenantContext } from '../shared/application/tenant-context.js';

/**
 * Smoke MANUAL do briefing de criação de agente, contra o modelo real.
 *
 * Existe porque nenhum teste com dublê responde a pergunta que importa aqui:
 * o modelo pergunta ESPECIALIZAÇÃO (o nível do agente) ou fato de campanha?
 */
const ROLES = [
  'Representante Comercial Estratégico',
  'Atendente de suporte técnico',
  'Consultor de soluções para clínicas odontológicas',
];

async function main(): Promise<void> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');

  const container = createContainer();
  const { added, version } = await container.hub.policies.syncSections(
    MASTER_POLICY_NAME,
    MASTER_POLICY_V1,
  );
  console.log(`policy v${version.versionNumber} · novas: ${added.join(', ') || '(nenhuma)'}`);

  const account = await getDb().account.findFirstOrThrow();
  const context = { ...systemTenantContext('smoke:briefing'), accountId: account.id };

  for (const role of ROLES) {
    const started = Date.now();
    const result = await container.agents.planBriefing.execute(context, role);
    console.log(`\n=== ${role} · ${Date.now() - started}ms ===`);
    for (const question of result.questions) {
      console.log(`· ${question.question}`);
      console.log(`  ↳ ${question.why}`);
    }
  }

  process.exit(0);
}

void main();
