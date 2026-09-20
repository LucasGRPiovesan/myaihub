import { paginationQuerySchema, summarizeProjectProfile } from '@myaihub/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseParams, parseQuery } from '../../../http/validate.js';
import type { TokenService } from '../../../shared/application/ports.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { ProjectRepository } from '../domain/repositories.js';

export interface ProjectsRouterDependencies {
  tokens: TokenService;
  projects: ProjectRepository;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

export function createProjectsRouter(deps: ProjectsRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.get('/projects', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { limit, cursor } = parseQuery(paginationQuerySchema, request);

    const items = await deps.projects.list(tenant, limit, cursor ?? null);

    response.json({
      items: items.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        createdAt: project.createdAt.toISOString(),
      })),
      nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null,
    });
  });

  router.get('/projects/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const found = await deps.projects.findById(tenant, id);
    if (!found) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

    response.json({
      id: found.project.id,
      name: found.project.name,
      slug: found.project.slug,
      status: found.project.status,
      lockVersion: found.project.lockVersion,
      profile: found.profile
        ? {
            versionNumber: found.profile.versionNumber,
            canonical: found.profile.canonicalConfig,
            // Derivado do canônico, não armazenado em paralelo: os dois nunca
            // divergem porque só existe uma fonte.
            summary: summarizeProjectProfile(found.profile.canonicalConfig),
            createdAt: found.profile.createdAt.toISOString(),
          }
        : null,
    });
  });

  /** Histórico de versões do perfil — base do rollback (§18). */
  router.get('/projects/:id/versions', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const project = await deps.projects.findById(tenant, id);
    if (!project) throw new NotFoundError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');

    const versions = await deps.projects.listVersions(tenant, id, 50);

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

  return router;
}
