import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireRole,
  requireTenant,
} from '../../../http/middlewares/authenticate.js';
import { parseBody, parseParams } from '../../../http/validate.js';
import type { AuditWriter, TokenService } from '../../../shared/application/ports.js';
import { elevateScope, runWithTenantContext } from '../../../shared/application/tenant-context.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { DistillPlaybookUseCase } from '../application/distill-playbook.use-case.js';
import type { RevisePlaybookUseCase } from '../application/revise-playbook.use-case.js';
import { agentPlaybookSchema } from '../domain/playbook.js';
import type { PlaybookRepository, SupportRepository } from '../domain/repositories.js';

/**
 * Administração da PLATAFORMA, não da conta.
 *
 * Playbook de ofício vale para todo cliente, então quem mexe aqui é o admin da
 * plataforma — `UserRole.ADMIN`, que já existe e é distinto de `MembershipRole`
 * (o papel dentro de UMA conta). O dono de uma conta não pode alterar o ofício
 * que os agentes de todas as outras vão herdar.
 */
export interface AdminRouterDependencies {
  tokens: TokenService;
  playbooks: PlaybookRepository;
  /** A pauta de suporte — limites do sistema que o S.O encontrou. */
  support: SupportRepository;
  distill: DistillPlaybookUseCase;
  revise: RevisePlaybookUseCase;
  audit: AuditWriter;
}

const keyParamSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
    .max(60),
});

const saveSchema = z.object({
  playbook: agentPlaybookSchema,
  /** Por que esta versão existe. Fica no histórico — é o que explica a mudança. */
  reason: z.string().trim().min(3).max(300),
});

const reviseSchema = z.object({
  instruction: z.string().trim().min(3, 'Diga o que você quer mudar.').max(2000),
});

const distillSchema = z.object({
  // Um estudo de mercado passa de 60KB com facilidade. O teto é generoso de
  // propósito: cortar o documento produziria um playbook que ignora o fim dele.
  document: z.string().trim().min(200).max(400_000),
  roleHint: z.string().trim().max(200).optional(),
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
    .max(60)
    .optional(),
});

export function createAdminRouter(deps: AdminRouterDependencies): Router {
  const router = Router();
  const admin = [authenticate(deps.tokens), requireRole('ADMIN')];

  router.get('/admin/playbooks', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const items = await deps.playbooks.listForAdmin();

    // Contagem CROSS-TENANT: a pergunta é da plataforma ("quantos agentes
    // vieram deste ofício?"), não de uma conta. Mesma disciplina da pauta:
    // elevação explícita, com motivo e registro.
    const reason = 'Quantos agentes cada playbook produziu, na plataforma.';
    const elevated = elevateScope(tenant, tenant.accountId, reason);

    await deps.audit.write({
      accountId: tenant.accountId,
      actorUserId: tenant.userId,
      action: 'ADMIN_PLAYBOOK_USAGE_READ',
      entityType: 'PLAYBOOK',
      entityId: null,
      metadata: { reason },
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });

    const counts = await runWithTenantContext(elevated, () =>
      deps.playbooks.countAgentsByPlaybook(),
    );

    response.json({
      items: items.map((item) => ({
        key: item.playbook.key,
        label: item.playbook.label,
        versionNumber: item.versionNumber,
        updatedAt: item.updatedAt.toISOString(),
        principles: item.playbook.principles.length,
        antiPatterns: item.playbook.antiPatterns.length,
        questions: item.playbook.worthAsking.length,
        agents: counts[item.playbook.key] ?? 0,
      })),
    });
  });

  router.get('/admin/playbooks/:key', ...admin, async (request, response) => {
    const { key } = parseParams(keyParamSchema, request);

    const playbook = await deps.playbooks.findByKey(key);
    if (!playbook) throw new NotFoundError('NOT_FOUND', 'Playbook não encontrado.');

    response.json({
      playbook,
      history: (await deps.playbooks.history(key)).map((version) => ({
        versionNumber: version.versionNumber,
        reason: version.reason,
        createdAt: version.createdAt.toISOString(),
      })),
    });
  });

  /**
   * Salvar é criar VERSÃO NOVA, sempre.
   *
   * Curadoria de ofício é opinião sobre como um profissional trabalha, e opinião
   * erra. Sobrescrever tiraria a única saída possível: voltar para a anterior.
   */
  router.put('/admin/playbooks/:key', ...admin, async (request, response) => {
    const { key } = parseParams(keyParamSchema, request);
    const input = parseBody(saveSchema, request);

    const versionNumber = await deps.playbooks.saveVersion(key, input.playbook, input.reason);
    response.json({ key, versionNumber });
  });

  /**
   * O OS calibra o playbook a pedido, em linguagem natural.
   *
   * PROPÕE, não aplica: um playbook vale para todas as contas, e uma alteração
   * ruim nasceria dentro de todo agente daquele papel. O admin vê o que mudou e
   * salva — aí sim vira versão.
   */
  router.post('/admin/playbooks/:key/revise', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const { key } = parseParams(keyParamSchema, request);
    const { instruction } = parseBody(reviseSchema, request);

    const playbook = await deps.playbooks.findByKey(key);
    if (!playbook) throw new NotFoundError('NOT_FOUND', 'Playbook não encontrado.');

    response.json(await deps.revise.execute(tenant, { playbook, instruction }));
  });

  router.post('/admin/playbooks/distill', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const input = parseBody(distillSchema, request);

    response.json(
      await deps.distill.execute(tenant, {
        document: input.document,
        ...(input.roleHint ? { roleHint: input.roleHint } : {}),
        ...(input.key ? { key: input.key } : {}),
      }),
    );
  });

  /**
   * As correções de OFÍCIO que o OS aplicou em agentes deste papel.
   *
   * É pauta, não fila de aprovação: o usuário já recebeu o ajuste no agente
   * dele. O que está aqui é o padrão — quando a mesma correção aparece em
   * vários agentes, o playbook está incompleto, e a decisão de promovê-la é
   * tomada uma vez, com evidência.
   */
  router.get('/admin/playbooks/:key/suggestions', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const { key } = parseParams(keyParamSchema, request);

    const reason = 'Pauta de calibração: correções de ofício aplicadas em agentes.';
    const elevated = elevateScope(tenant, tenant.accountId, reason);

    await deps.audit.write({
      accountId: tenant.accountId,
      actorUserId: tenant.userId,
      action: 'ADMIN_PLAYBOOK_SUGGESTIONS_READ',
      entityType: 'PLAYBOOK',
      entityId: key,
      metadata: { reason },
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });

    const items = await runWithTenantContext(elevated, () =>
      deps.playbooks.listSuggestions(key, 50),
    );

    response.json({
      items: items.map((item) => ({
        summary: item.summary,
        statement: item.statement,
        facet: item.facet,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  });

  /**
   * Os papéis que ficaram sem playbook.
   *
   * É a pauta, não telemetria: ordenada por frequência, ela diz qual é o próximo
   * playbook que vale escrever. Sem isso a lacuna é invisível — o agente nasce
   * genérico e ninguém fica sabendo.
   */
  router.get('/admin/playbook-misses', ...admin, async (request, response) => {
    const tenant = requireTenant(request);

    // Leitura CROSS-TENANT, e ela precisa ser: a pauta é da plataforma, e um
    // papel pedido na conta A é exatamente o sinal de que falta playbook para
    // todas. O tenantGuard barrou isto na primeira tentativa — fez o trabalho
    // dele. A saída certa não é afrouxar a classificação do modelo, é elevar o
    // escopo explicitamente, com motivo e registro.
    const reason = 'Pauta de playbooks: papéis sem ofício, agregados na plataforma.';
    const elevated = elevateScope(tenant, tenant.accountId, reason);

    await deps.audit.write({
      accountId: tenant.accountId,
      actorUserId: tenant.userId,
      action: 'ADMIN_PLAYBOOK_MISSES_READ',
      entityType: 'PLAYBOOK',
      entityId: null,
      metadata: { reason },
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });

    const items = await runWithTenantContext(elevated, () => deps.playbooks.listMisses(50));

    response.json({
      items: items.map((item) => ({
        role: item.role,
        count: item.count,
        lastSeen: item.lastSeen.toISOString(),
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // Suporte: o que o S.O não conseguiu fazer por limite do SISTEMA.
  //
  // Cross-tenant pelo mesmo motivo da pauta de ofícios: uma capacidade que
  // falta para uma conta falta para todas. Elevação explícita, com motivo e
  // registro — o guard barra o resto, e está certo.
  // ---------------------------------------------------------------------------

  router.get('/admin/support/limitations', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const { status } = z
      .object({ status: z.enum(['OPEN', 'RESOLVED']).optional() })
      .parse(request.query);

    const reason = 'Pauta de suporte: limites do sistema que o S.O encontrou.';
    const elevated = elevateScope(tenant, tenant.accountId, reason);

    await deps.audit.write({
      accountId: tenant.accountId,
      actorUserId: tenant.userId,
      action: 'ADMIN_SUPPORT_LIMITATIONS_READ',
      entityType: 'SYSTEM_LIMITATION',
      entityId: null,
      metadata: { reason, status: status ?? 'ALL' },
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });

    const items = await runWithTenantContext(elevated, () =>
      deps.support.listLimitations(elevated, status ? { status } : {}, 200),
    );

    response.json({
      items: items.map((item) => ({
        id: item.id,
        accountId: item.accountId,
        operation: item.operation,
        summary: item.summary,
        need: item.need,
        userMessage: item.userMessage,
        status: item.status,
        resolutionNote: item.resolutionNote,
        resolvedAt: item.resolvedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  });

  router.post('/admin/support/limitations/:id/resolve', ...admin, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(
      z.object({ id: z.string().length(26, 'Identificador inválido.') }),
      request,
    );
    const { note } = parseBody(
      z.object({
        // O que foi feito no MyAIHub. Sem isto, "resolvido" não diz a quem
        // voltar a esbarrar no mesmo limite onde procurar a correção.
        note: z.string().trim().min(3, 'Diga o que foi feito.').max(600),
      }),
      request,
    );

    const reason = 'Resolver item da pauta de suporte.';
    const elevated = elevateScope(tenant, tenant.accountId, reason);

    const ok = await runWithTenantContext(elevated, () =>
      deps.support.resolveLimitation(elevated, id, note),
    );
    if (!ok) throw new NotFoundError('NOT_FOUND', 'Item de suporte não encontrado.');

    await deps.audit.write({
      accountId: tenant.accountId,
      actorUserId: tenant.userId,
      action: 'ADMIN_SUPPORT_LIMITATION_RESOLVED',
      entityType: 'SYSTEM_LIMITATION',
      entityId: id,
      metadata: { note },
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });

    response.status(204).end();
  });

  return router;
}
