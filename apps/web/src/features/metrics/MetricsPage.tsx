import { useParams } from 'react-router';
import { useCampaign } from '../campaigns/campaigns.api';
import { useProject } from '../projects/projects.api';
import { MetricsDashboard } from './MetricsDashboard';

/**
 * As três telas de métrica — a mesma, com filtro diferente.
 *
 * Componentes separados só para o cabeçalho: o dashboard é um só, e é o que
 * garante que "conversa engajada" signifique a mesma coisa nos três lugares.
 */

export function AccountMetricsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Resultados</h1>
      <p className="mt-1 text-sm text-text-muted">Todas as campanhas publicadas da conta.</p>
      <div className="mt-5">
        <MetricsDashboard />
      </div>
    </div>
  );
}

export function ProjectMetricsPage() {
  const { projectId } = useParams();
  const { data: project } = useProject(projectId);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Métricas</h1>
      <p className="mt-1 text-sm text-text-muted">{project?.name}</p>
      <div className="mt-5">
        <MetricsDashboard projectId={projectId} />
      </div>
    </div>
  );
}

export function CampaignMetricsPage() {
  const { campaignId } = useParams();
  const { data: campaign } = useCampaign(campaignId);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Resultados</h1>
      <p className="mt-1 text-sm text-text-muted">{campaign?.name}</p>
      <div className="mt-5">
        <MetricsDashboard campaignId={campaignId} />
      </div>
    </div>
  );
}
