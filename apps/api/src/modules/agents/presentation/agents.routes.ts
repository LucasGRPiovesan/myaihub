import { paginationQuerySchema, summarizeAgent } from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseBody, parseParams, parseQuery } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { DeleteAgentUseCase } from '../application/delete-agent.use-case.js';
import type { PlanAgentBriefingUseCase } from '../application/plan-agent-briefing.use-case.js';
import type { TestAgentUseCase } from '../application/test-agent.use-case.js';
import type { AgentRepository } from '../domain/repositories.js';
import { CORE_PLAYBOOK_KEY } from '../../myaihub/domain/playbook.js';
import type { PlaybookRepository } from '../../myaihub/domain/repositories.js';
import type { SyncAgentCraftUseCase } from '../../myaihub/application/sync-agent-craft.use-case.js';

export interface AgentsRouterDependencies {
  tokens: TokenService;
  playbooks: PlaybookRepository;
  /** Sincronizar pelo ofício escreve pela MESMA porta da edição manual. */
  syncCraft: SyncAgentCraftUseCase;
  agents: AgentRepository;
  deleteAgent: DeleteAgentUseCase;
  testAgent: TestAgentUseCase;
  planBriefing: PlanAgentBriefingUseCase;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

/**
 * O histórico é do SERVIDOR, pelo `sessionId` (Fase 8).
 *
 * Ele vinha do cliente porque o Lab era efêmero por falta desta fase. A
 * conversa de teste agora persiste em canal próprio (`LAB`), que fica FORA de
 * toda métrica — a razão original continua valendo, e é o canal que a resolve,
 * não a ausência de persistência. O que se ganha: o teste sobrevive a um
 * recarregamento, e é ele que o OS lê para diagnosticar.
 */
const inlineImageSchema = z.object({
  mimeType: z.string().trim().max(60),
  /** Base64 puro, sem o prefixo `data:`. Validado de verdade em `test-agent.use-case.ts`. */
  data: z.string().min(1),
});

const testAgentSchema = z
  .object({
    // Sem `min(1)`: uma foto sem legenda ("segue a peça") é o caso mais comum
    // de anexo, e não pode ser recusada por não ter texto.
    message: z.string().trim().max(2000),
    campaignId: z.string().length(26).optional(),
    /** Teste no contexto do PROJETO inteiro. Ignorado quando há campanha. */
    projectId: z.string().length(26).optional(),
    scenario: z.string().trim().max(1500).optional(),
    sessionId: z.string().length(26).optional(),
    /** Efêmero: vira `LlmImagePart` deste turno e nunca é persistido. */
    images: z.array(inlineImageSchema).max(3).default([]),
  })
  .refine((body) => body.message.length > 0 || body.images.length > 0, {
    message: 'Escreva alguma coisa ou anexe uma imagem.',
    path: ['message'],
  });

const briefingSchema = z.object({
  role: z.string().trim().min(3, 'Diga que tipo de agente você quer.').max(300),
  /**
   * Tipo escolhido na tela, entre os cadastrados.
   *
   * Quando vem, a classificação já foi feita por uma pessoa e o briefing não
   * precisa de modelo nenhum. O servidor valida a chave contra o catálogo.
   */
  playbookKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
    .max(60)
    .optional(),
});

const openingSchema = z.object({
  campaignId: z.string().length(26).optional(),
  /** Teste no contexto do PROJETO inteiro. Ignorado quando há campanha. */
  projectId: z.string().length(26).optional(),
  scenario: z.string().trim().max(1500).optional(),
  /**
   * A conversa a RETOMAR, quando o usuário reinicia mantendo o contexto.
   *
   * Sem ela o agente reabre como se fosse a primeira vez: se apresenta de novo
   * e pergunta o nome de quem acabou de dizê-lo. A tela mantém o transcrito na
   * frente do usuário, então a fala precisa continuar a MESMA conversa — e
   * agora quem sabe o que foi dito é o servidor, não o navegador.
   */
  sessionId: z.string().length(26).optional(),
});

export function createAgentsRouter(deps: AgentsRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.get('/agents', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { limit, cursor } = parseQuery(paginationQuerySchema, request);

    const items = await deps.agents.list(tenant, limit, cursor ?? null);

    response.json({
      items: items.map((agent) => ({
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        role: agent.role,
        status: agent.status,
        createdAt: agent.createdAt.toISOString(),
      })),
      nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null,
    });
  });

  /**
   * Os tipos de agente que o sistema conhece de verdade.
   *
   * São os playbooks de ofício cadastrados pelo admin — o que aparece aqui é o
   * que o OS sabe projetar bem. Uma lista fixa em código diria ao usuário que o
   * sistema conhece sete papéis, quando na verdade conhece os que têm playbook.
   *
   * Só chave e nome: o conteúdo do playbook é da administração.
   *
   * Fica ANTES de `/agents/:id`: o Express casa na ordem de registro, e depois
   * dela "types" viraria um id — que foi exatamente o 422 que apareceu.
   */
  router.get('/agents/types', auth, async (_request, response) => {
    const playbooks = await deps.playbooks.listCurrent();

    response.json({
      items: playbooks
        .filter((playbook) => playbook.key !== CORE_PLAYBOOK_KEY)
        .map((playbook) => ({ key: playbook.key, label: playbook.label })),
    });
  });

  router.get('/agents/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const found = await deps.agents.findById(tenant, id);
    if (!found) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

    // O ofício de origem, e se ele andou desde que este agente foi projetado.
    //
    // O agente NÃO é reescrito quando o admin edita o playbook: o que está
    // publicado não pode mudar de comportamento pelas costas de quem publicou.
    // O que muda é a visibilidade — o produto passa a poder dizer "o piso deste
    // papel evoluiu", e a atualização acontece pelo caminho normal de ajuste,
    // com o guard de regressão no meio.
    const canonical = found.version?.canonicalConfig ?? null;
    const craftKey = canonical?.playbookKey ?? '';
    const current = craftKey ? await deps.playbooks.findCurrent(craftKey) : null;

    response.json({
      id: found.agent.id,
      name: found.agent.name,
      slug: found.agent.slug,
      role: found.agent.role,
      status: found.agent.status,
      lockVersion: found.agent.lockVersion,
      configuration: found.version
        ? {
            versionNumber: found.version.versionNumber,
            canonical: found.version.canonicalConfig,
            // Derivado do canônico, não guardado em paralelo: os dois nunca
            // divergem porque só existe uma fonte.
            summary: summarizeAgent(found.version.canonicalConfig),
            createdAt: found.version.createdAt.toISOString(),
          }
        : null,
      craft: current
        ? {
            key: current.playbook.key,
            label: current.playbook.label,
            seenVersion: canonical?.playbookVersion ?? 0,
            currentVersion: current.versionNumber,
          }
        : null,
    });
  });

  /** Histórico de versões — base do rollback (§18). */
  router.get('/agents/:id/versions', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const agent = await deps.agents.findById(tenant, id);
    if (!agent) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

    const versions = await deps.agents.listVersions(tenant, id, 50);

    response.json({
      items: versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        source: version.source,
        reason: version.reason,
        createdAt: version.createdAt.toISOString(),
      })),
    });
  });

  /**
   * O que impede excluir. A tela pergunta ANTES de oferecer o botão — descobrir
   * o bloqueio depois do "confirmar" é a pior hora de descobrir.
   */
  router.get('/agents/:id/deletion-blockers', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const agent = await deps.agents.findById(tenant, id);
    if (!agent) throw new NotFoundError('AGENT_NOT_FOUND', 'Agente não encontrado.');

    response.json({ items: await deps.deleteAgent.blockers(tenant, id) });
  });

  router.delete('/agents/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    await deps.deleteAgent.execute(tenant, id);
    response.status(204).end();
  });

  /** Internal Lab: conversa com o agente sem publicar nada. */
  router.post('/agents/:id/test', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);
    const input = parseBody(testAgentSchema, request);

    const result = await deps.testAgent.execute(tenant, {
      agentId: id,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.scenario ? { scenario: input.scenario } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      message: input.message,
      ...(input.images.length ? { images: input.images } : {}),
    });

    response.json(result);
  });

  /**
   * As perguntas que precedem a criação.
   *
   * Rota própria, e não uma operação do OS: aqui nada é criado, versionado ou
   * auditado — é uma pergunta sobre um agente que ainda não existe. Forçá-la no
   * pipeline de mutação exigiria um alvo que não há.
   */
  router.post('/agents/briefing', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { role, playbookKey } = parseBody(briefingSchema, request);

    response.json(await deps.planBriefing.execute(tenant, role, playbookKey));
  });

  /** Põe o agente em dia com o ofício, sem modelo. Ver `SyncAgentCraftUseCase`. */
  router.post('/agents/:id/sync-craft', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    response.json(await deps.syncCraft.execute(tenant, id));
  });

  /** A primeira fala, quando é o agente quem abre. */
  router.post('/agents/:id/opening', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(openingSchema, request);

    response.json(
      await deps.testAgent.open(tenant, id, {
        ...(body.campaignId ? { campaignId: body.campaignId } : {}),
        ...(body.projectId ? { projectId: body.projectId } : {}),
        ...(body.scenario ? { scenario: body.scenario } : {}),
        ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      }),
    );
  });

  return router;
}
