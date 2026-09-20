import {
  brandIdentityGaps,
  createKnowledgeSourceSchema,
  defaultBrandIdentity,
  KNOWLEDGE_MAX_CONTENT,
  summarizeBrandIdentity,
} from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseBody, parseParams } from '../../../http/validate.js';
import type { IdGenerator, TokenService } from '../../../shared/application/ports.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { brandMutationSchema } from '../domain/brand-mutations.js';
import type { BrandIdentityRepository } from '../domain/brand-repositories.js';
import type { ProjectRepository } from '../domain/repositories.js';
import { ApplyBrandIdentityUseCase } from '../application/apply-brand-identity.use-case.js';
import type { ManageKnowledgeUseCase } from '../application/manage-knowledge.use-case.js';

export interface ProjectAssetsRouterDependencies {
  tokens: TokenService;
  projects: ProjectRepository;
  brands: BrandIdentityRepository;
  knowledge: ManageKnowledgeUseCase;
  ids: IdGenerator;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });
const sourceParamSchema = z.object({
  id: z.string().length(26, 'Identificador inválido.'),
  sourceId: z.string().length(26, 'Identificador inválido.'),
});

/**
 * Marca e conhecimento do projeto (Fase 5).
 *
 * A EDIÇÃO MANUAL da marca passa pelas MESMAS mutações tipadas que o OS usa —
 * é o mesmo aplicador, o mesmo merge, o mesmo versionamento, só com
 * `source: 'USER'`. Não é porta dos fundos: um segundo caminho de escrita
 * significaria dois comportamentos para "trocar a cor", e o segundo nunca
 * receberia as correções do primeiro.
 *
 * Conhecimento NÃO passa por mutação, e a assimetria é deliberada: fonte não é
 * documento de configuração, é conteúdo do cliente. Mutá-la por modelo
 * devolveria paráfrase no lugar do texto dele.
 */
export function createProjectAssetsRouter(deps: ProjectAssetsRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);
  const applyBrand = new ApplyBrandIdentityUseCase({
    brands: deps.brands,
    projects: deps.projects,
    ids: deps.ids,
  });

  router.get('/projects/:id/brand', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const project = await deps.projects.findById(tenant, id);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

    const current = await deps.brands.findCurrent(tenant, id);
    // Projeto sem identidade responde o DEFAULT, não nulo: é o que o público já
    // veria hoje, e devolver nulo obrigaria cada tela a inventar o seu próprio.
    const canonical = current?.canonicalConfig ?? defaultBrandIdentity(project.project.name);

    response.json({
      versionNumber: current?.versionNumber ?? 0,
      canonical,
      summary: summarizeBrandIdentity(canonical),
      gaps: brandIdentityGaps(canonical),
      lockVersion: project.project.lockVersion,
    });
  });

  router.get('/projects/:id/brand/versions', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const versions = await deps.brands.listVersions(tenant, id, 50);

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

  router.post('/projects/:id/brand/mutations', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(
      z.object({
        mutations: z.array(brandMutationSchema).min(1).max(1),
        reason: z.string().trim().min(3).max(300).default('Ajuste manual da identidade'),
      }),
      request,
    );

    // A MESMA porta que o S.O usa ao extrair a identidade de um site: dois
    // caminhos de escrita para a marca divergiriam no primeiro ajuste.
    const resultado = await applyBrand.execute(tenant, {
      projectId: id,
      mutations: body.mutations,
      reason: body.reason,
      source: 'USER',
    });

    response.json(resultado);
  });

  // ---------------------------------------------------------------------------
  // Conhecimento
  // ---------------------------------------------------------------------------

  router.get('/projects/:id/knowledge', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    response.json({ items: await deps.knowledge.list(tenant, id) });
  });

  router.post('/projects/:id/knowledge', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(createKnowledgeSourceSchema, request);

    const project = await deps.projects.findById(tenant, id);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

    response.status(201).json(await deps.knowledge.create(tenant, id, body));
  });

  router.post('/projects/:id/knowledge/:sourceId/reindex', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { sourceId } = parseParams(sourceParamSchema, request);

    response.json(await deps.knowledge.reindex(tenant, sourceId));
  });

  router.put('/projects/:id/knowledge/:sourceId', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { sourceId } = parseParams(sourceParamSchema, request);
    const body = parseBody(
      z.object({ content: z.string().trim().min(1).max(KNOWLEDGE_MAX_CONTENT) }),
      request,
    );

    response.json(await deps.knowledge.replaceText(tenant, sourceId, body.content));
  });

  router.delete('/projects/:id/knowledge/:sourceId', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { sourceId } = parseParams(sourceParamSchema, request);

    await deps.knowledge.remove(tenant, sourceId);
    response.status(204).end();
  });

  return router;
}
