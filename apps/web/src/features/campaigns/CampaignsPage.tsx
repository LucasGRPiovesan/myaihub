import { Megaphone, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Badge, EmptyState, SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { useHub } from '../hub/HubProvider';
import { useProject } from '../projects/projects.api';
import { useProjectCampaigns, type CampaignStatus } from './campaigns.api';

const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: 'rascunho',
  PUBLISHED: 'publicada',
  PAUSED: 'pausada',
  ARCHIVED: 'arquivada',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge tone={status === 'PUBLISHED' ? 'success' : 'neutral'}>{STATUS_LABEL[status]}</Badge>
  );
}

export function CampaignsPage() {
  const { projectId } = useParams();
  const { data: project } = useProject(projectId);
  const { data: campaigns, isPending, isError } = useProjectCampaigns(projectId);
  const { open } = useHub();

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
        <Card className="mt-5 p-6">
          <SkeletonText lines={4} />
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
        <Card className="mt-5 p-6">
          <p role="alert" className="text-sm text-danger">
            Não foi possível carregar as campanhas. Recarregue a página.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
          <p className="mt-1 truncate text-sm text-text-muted">
            {project?.name ? `Campanhas de ${project.name}.` : 'Campanhas deste projeto.'}
          </p>
        </div>
        {campaigns.length > 0 && (
          <Button size="sm" onClick={open}>
            <Plus aria-hidden className="size-4" />
            Nova campanha
          </Button>
        )}
      </div>

      {campaigns.length === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={Megaphone}
            title="Nenhuma campanha ainda"
            description="Descreva o objetivo da campanha e com quem ela fala. O MyAIHub monta a estratégia a partir do perfil deste projeto — depois você vincula o agente que vai conversar."
            action={
              <Button onClick={open}>
                <Plus aria-hidden className="size-4" />
                Criar primeira campanha
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={`/projetos/${projectId}/campanhas/${campaign.id}`}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-sunken"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{campaign.name}</span>
                  <span className="block truncate text-xs text-text-subtle">
                    {campaign.agentId ? 'agente vinculado' : 'sem agente vinculado'}
                  </span>
                </span>
                <CampaignStatusBadge status={campaign.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
