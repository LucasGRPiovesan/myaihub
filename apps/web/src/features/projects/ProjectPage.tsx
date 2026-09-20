import {
  PROJECT_FACET_DESCRIPTIONS,
  PROJECT_FACET_LABELS,
  PROJECT_FACET_SLUGS,
  type CanonicalProjectProfile,
  type ProjectFacet,
} from '@myaihub/shared';
import { FlaskConical, ShieldAlert, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { CampaignCarousel } from '../campaigns/CampaignCarousel';
import { useProjectCampaigns } from '../campaigns/campaigns.api';
import { useHub } from '../hub/HubProvider';
import { useProject, useProjectVersions } from './projects.api';

/**
 * A ordem de leitura do perfil — a mesma da sidebar e a mesma do prompt.
 *
 * Três ordens diferentes para as mesmas seis seções fariam o usuário reaprender
 * o documento a cada tela.
 */
const FACET_ORDER: ProjectFacet[] = [
  'offerings',
  'audiences',
  'valuePropositions',
  'differentiators',
  'market',
  'businessRules',
];

/**
 * O MAPA do perfil, não o perfil inteiro.
 *
 * A Visão Geral listava as seis facetas abertas, uma embaixo da outra, com o
 * painel do OS ocupando um quarto da tela ao lado. Agora cada seção é uma rota
 * e esta tela vira a capa: o que o projeto tem, onde, e o que está vazio.
 * Contar é mais útil que despejar — a contagem é o que responde "o que falta?".
 */
function ProfileMap({
  projectId,
  profile,
}: {
  projectId: string;
  profile: CanonicalProjectProfile;
}) {
  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      {FACET_ORDER.map((facet) => {
        const total = profile[facet].length;
        const obrigatorias =
          facet === 'businessRules'
            ? profile.businessRules.filter((item) => item.enforcement !== 'SOFT').length
            : 0;

        return (
          <Link
            key={facet}
            to={`/projetos/${projectId}/${PROJECT_FACET_SLUGS[facet]}`}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:border-border-strong"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">{PROJECT_FACET_LABELS[facet]}</p>
              <span className="shrink-0 font-mono text-[13px] text-text-subtle">{total}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-text-muted">
              {total === 0 ? 'Vazio. ' : ''}
              {PROJECT_FACET_DESCRIPTIONS[facet]}
            </p>
            {obrigatorias > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-subtle">
                <ShieldAlert aria-hidden className="size-3.5" />
                {obrigatorias} inegociável{obrigatorias > 1 ? 'is' : ''} para os agentes
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Campanhas do projeto, na visão geral.
 *
 * É a ponte entre o perfil e o que se faz com ele: sem isto, o usuário lia o
 * perfil e não tinha caminho para a única coisa acionável que o projeto oferece.
 */
function ProjectCampaigns({ projectId }: { projectId: string }) {
  const { data: campaigns } = useProjectCampaigns(projectId);
  const { open } = useHub();

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
          Campanhas
        </p>
        <Button size="sm" variant="secondary" onClick={open}>
          <Sparkles aria-hidden className="size-4" />
          Nova campanha
        </Button>
      </div>

      {!campaigns || campaigns.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          Nenhuma campanha ainda. Uma campanha usa este perfil para especializar a atuação de um
          agente num objetivo específico.
        </p>
      ) : (
        <CampaignCarousel campaigns={campaigns} projectId={projectId} />
      )}
    </Card>
  );
}

export function ProjectPage() {
  const { projectId } = useParams();
  const { data: project, isPending, isError } = useProject(projectId);
  const { data: versions } = useProjectVersions(projectId);
  const { open } = useHub();

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Projeto não encontrado.
          </p>
        </Card>
      </div>
    );
  }

  const profile = project.profile?.canonical;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
          {profile && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <Badge>{profile.type}</Badge>
              {profile.business.model && <span>{profile.business.model}</span>}
              <span>versão {project.profile?.versionNumber}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to={`/projetos/${project.id}/testar`}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-[13px] hover:border-border-strong hover:bg-surface-sunken"
          >
            <FlaskConical aria-hidden className="size-4" />
            Testar agente
          </Link>
          <Button size="sm" variant="secondary" onClick={open}>
            <Sparkles aria-hidden className="size-4" />
            Ajustar
          </Button>
        </div>
      </div>

      {profile?.summary && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed">{profile.summary}</p>
        </Card>
      )}

      {profile && <ProfileMap projectId={project.id} profile={profile} />}

      {projectId && <ProjectCampaigns projectId={projectId} />}

      {versions && versions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
            Histórico
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {versions.map((version) => (
              <li key={version.id} className="flex items-baseline gap-3 text-[13px]">
                <span className="font-mono text-[11px] text-text-subtle">
                  v{version.versionNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-muted">{version.reason}</span>
                <span className="shrink-0 text-xs text-text-subtle">
                  {new Date(version.createdAt).toLocaleDateString('pt-BR')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
