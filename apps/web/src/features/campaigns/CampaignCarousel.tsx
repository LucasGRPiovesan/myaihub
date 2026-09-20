import { Megaphone } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../design-system/feedback';
import type { CampaignListItem } from './campaigns.api';

/**
 * Cada campanha como um "anúncio" numa tela de celular — o mesmo formato em
 * que ela seria vista de verdade. "Saiba Mais" simula o clique no anúncio:
 * leva ao Lab da campanha, não ao chat público (testar não exige publicação).
 */
export function CampaignCarousel({
  campaigns,
  projectId,
}: {
  campaigns: CampaignListItem[];
  projectId: string;
}) {
  return (
    <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pt-1 pb-3">
      {campaigns.map((campaign) => (
        <PhoneCard key={campaign.id} campaign={campaign} projectId={projectId} />
      ))}
    </div>
  );
}

function PhoneCard({ campaign, projectId }: { campaign: CampaignListItem; projectId: string }) {
  return (
    <div className="w-[220px] shrink-0 snap-center">
      <div className="relative flex aspect-[9/16] flex-col overflow-hidden rounded-[28px] border-4 border-border-strong bg-surface-sunken shadow-[var(--shadow-card)]">
        {campaign.status === 'PUBLISHED' && (
          <div className="absolute top-3 right-3 z-10">
            <Badge tone="success">no ar</Badge>
          </div>
        )}

        <div className="relative flex-1 overflow-hidden">
          {campaign.heroImageUrl ? (
            <img
              src={campaign.heroImageUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-sunken px-4 text-center">
              <Megaphone aria-hidden className="size-6 text-text-subtle" />
              <p className="line-clamp-3 text-[13px] text-text-muted">{campaign.name}</p>
            </div>
          )}

          {campaign.heroImageUrl && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-2">
              <p className="line-clamp-2 text-[13px] font-medium text-white">{campaign.name}</p>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-surface p-2">
          <Link
            to={`/projetos/${projectId}/campanhas/${campaign.id}/testar`}
            className="flex h-9 items-center justify-center rounded-[var(--radius-control)] bg-accent text-[13px] font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
          >
            Saiba Mais
          </Link>
        </div>
      </div>

      <Link
        to={`/projetos/${projectId}/campanhas/${campaign.id}`}
        className="mt-1.5 block truncate text-center text-[12px] text-text-subtle hover:text-text-muted"
      >
        Editar campanha
      </Link>
    </div>
  );
}
