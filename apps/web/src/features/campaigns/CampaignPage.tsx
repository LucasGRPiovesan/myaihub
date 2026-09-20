import {
  CAMPAIGN_FACET_CODES,
  CAMPAIGN_FACET_LABELS,
  CAMPAIGN_FACET_MUTATION,
  CAMPAIGN_REMOVE_MUTATION,
  CAMPAIGN_SEMANTIC_KEY_PREFIXES,
  type CampaignCta,
  type CampaignFacet,
} from '@myaihub/shared';
import {
  Check,
  ExternalLink,
  FlaskConical,
  Globe,
  ImagePlus,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Button, Card, Field, Input, cx } from '../../design-system/primitives';
import { refreshSession } from '../../lib/api-client';
import { useAgents } from '../agents/agents.api';
import { EditableFacet } from '../canonical/EditableFacet';
import { useManualMutations } from '../canonical/manual.api';
import { useHub } from '../hub/HubProvider';
import { CampaignStatusBadge } from './CampaignsPage';
import {
  useBindAgent,
  useCampaign,
  useCampaignVersions,
  useDeployments,
  usePublishCampaign,
} from './campaigns.api';

const FACET_ORDER = Object.keys(CAMPAIGN_FACET_CODES) as CampaignFacet[];

/**
 * Vínculo do agente.
 *
 * Um `select`, não uma conversa com o modelo: a escolha é entre agentes que o
 * usuário já tem, e um clique responde melhor que qualquer inferência (§31).
 */
function AgentBinding({
  campaignId,
  projectId,
  currentAgentId,
}: {
  campaignId: string;
  projectId: string;
  currentAgentId: string | null;
}) {
  const { data: agents } = useAgents();
  const bind = useBindAgent(campaignId);

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">Agente</p>
          <p className="mt-1 text-sm text-text-muted">
            Quem conversa com o público desta campanha.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="campaign-agent" className="sr-only">
            Agente da campanha
          </label>
          <select
            id="campaign-agent"
            value={currentAgentId ?? ''}
            disabled={bind.isPending || !agents}
            onChange={(event) => bind.mutate(event.target.value || null)}
            className={cx(
              'h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2.5',
              'text-sm text-text hover:border-border-strong disabled:opacity-60',
            )}
          >
            <option value="">Sem agente</option>
            {(agents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {agents?.length === 0 && (
        <p className="mt-3 text-[13px] text-text-subtle">
          Você ainda não tem agentes. Crie um em Agentes — ele poderá atuar em qualquer campanha.
        </p>
      )}

      {currentAgentId && (
        <p className="mt-3 text-[13px] text-text-muted">
          {/* Testar DAQUI é diferente de testar na tela do agente: aqui a
              campanha e o projeto já dizem o negócio, o público e o objetivo,
              então o teste mede a configuração em vez da imaginação do modelo. */}
          <Link
            to={`/projetos/${projectId}/campanhas/${campaignId}/testar`}
            className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
          >
            <FlaskConical aria-hidden className="size-3.5" />
            Testar com o contexto desta campanha
          </Link>
        </p>
      )}

      {bind.isError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {bind.error instanceof Error ? bind.error.message : 'Não foi possível vincular o agente.'}
        </p>
      )}
    </Card>
  );
}

const HERO_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const HERO_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Imagem do anúncio — o que aparece no carrossel de campanhas do projeto.
 *
 * Nasce automaticamente quando a campanha é criada a partir de uma mensagem
 * com uma imagem anexada (o runner injeta `SET_CAMPAIGN_HERO_IMAGE`
 * deterministicamente). Aqui é só a edição manual: mesma mutação, mesma
 * porta (`useManualMutations`), `source: 'USER'`.
 */
function HeroImageField({
  campaignId,
  heroImageUrl,
}: {
  campaignId: string;
  heroImageUrl: string | null;
}) {
  const mutate = useManualMutations('campaigns', campaignId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (file.size > HERO_IMAGE_MAX_BYTES) {
      setError('Imagem acima de 8 MB.');
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file, file.name || 'imagem');

      const send = () =>
        fetch('/api/media', {
          method: 'POST',
          credentials: 'include',
          body,
          signal: AbortSignal.timeout(HERO_UPLOAD_TIMEOUT_MS),
        });

      let response = await send();
      if (response.status === 401 && (await refreshSession())) {
        response = await send();
      }
      if (!response.ok) throw new Error('Não foi possível enviar a imagem.');

      const uploaded = (await response.json()) as { id: string };
      mutate.mutate({
        mutations: [{ kind: 'SET_CAMPAIGN_HERO_IMAGE', assetId: uploaded.id }],
        reason: 'Imagem do anúncio trocada manualmente',
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha no envio.');
    } finally {
      setUploading(false);
    }
  }

  function remove() {
    mutate.mutate({
      mutations: [{ kind: 'SET_CAMPAIGN_HERO_IMAGE', assetId: null }],
      reason: 'Imagem do anúncio removida manualmente',
    });
  }

  const busy = uploading || mutate.isPending;

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
            Imagem do anúncio
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Aparece no carrossel de campanhas do projeto, como se fosse o anúncio.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label
            className={cx(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)]',
              'border border-border bg-surface px-3 text-[13px] font-medium text-text',
              'hover:border-border-strong hover:bg-surface-sunken',
              busy && 'pointer-events-none opacity-55',
            )}
          >
            <ImagePlus aria-hidden className="size-3.5" />
            {heroImageUrl ? 'Trocar' : 'Enviar imagem'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void handleFile(file);
              }}
            />
          </label>
          {heroImageUrl && (
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
              Remover
            </Button>
          )}
        </div>
      </div>

      {heroImageUrl ? (
        <img
          src={heroImageUrl}
          alt=""
          className="mt-3 h-40 w-full rounded-[var(--radius-card)] border border-border object-cover"
        />
      ) : (
        <p className="mt-3 text-[13px] text-text-subtle">
          Sem imagem ainda — o cartão desta campanha no carrossel mostra só o nome.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

/**
 * CTA por FORMULÁRIO.
 *
 * É o caso mais claro do painel híbrido: rótulo do botão e URL de destino são
 * texto que o usuário já tem pronto. Passar isso por um modelo gastaria tokens
 * para transcrever — e o modelo já tentou publicar um CTA sem link uma vez.
 */
function CtaForm({ campaignId, cta }: { campaignId: string; cta: CampaignCta }) {
  const mutate = useManualMutations('campaigns', campaignId);
  const [label, setLabel] = useState(cta.label);
  const [url, setUrl] = useState(cta.url);
  const [condition, setCondition] = useState(cta.condition);

  const dirty = label !== cta.label || url !== cta.url || condition !== cta.condition;
  const wantsEnabled = label.trim().length > 0 && url.trim().length > 0;

  function save(enabled: boolean) {
    mutate.mutate({
      mutations: [
        {
          kind: 'SET_CAMPAIGN_CTA',
          enabled,
          label: label.trim(),
          url: url.trim(),
          condition: condition.trim(),
        },
      ],
      reason: enabled ? 'CTA definido manualmente' : 'CTA desativado manualmente',
    });
  }

  return (
    <Card className="mt-5 p-5">
      <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
        Chamada para ação
      </p>
      <p className="mt-1 text-sm text-text-muted">
        O desfecho da conversa. Preencha à mão — isto não precisa passar pela IA.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Texto do botão" htmlFor="cta-label">
          <Input
            id="cta-label"
            value={label}
            maxLength={80}
            placeholder="Quero receber clientes"
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field label="Link de destino" htmlFor="cta-url">
          <Input
            id="cta-url"
            value={url}
            maxLength={500}
            placeholder="https://..."
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field
          label="Quando oferecer"
          htmlFor="cta-condition"
          hint="Em linguagem natural — é o agente que julga se a conversa chegou lá."
        >
          <Input
            id="cta-condition"
            value={condition}
            maxLength={400}
            placeholder="Depois de entender o volume de trabalho da pessoa."
            onChange={(event) => setCondition(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!wantsEnabled || (!dirty && cta.enabled)}
          loading={mutate.isPending}
          onClick={() => save(true)}
        >
          <Check aria-hidden className="size-3.5" />
          {cta.enabled ? 'Salvar' : 'Ativar CTA'}
        </Button>
        {cta.enabled && (
          <Button size="sm" variant="ghost" onClick={() => save(false)}>
            Desativar
          </Button>
        )}
        {cta.enabled && <Badge tone="success">ativo</Badge>}
      </div>

      {mutate.isError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {mutate.error instanceof Error ? mutate.error.message : 'Não foi possível salvar o CTA.'}
        </p>
      )}
    </Card>
  );
}

function Publication({
  campaignId,
  blockers,
  publicId,
  deploymentNumber,
}: {
  campaignId: string;
  blockers: string[];
  publicId: string | null;
  deploymentNumber: number | null;
}) {
  const publish = usePublishCampaign(campaignId);
  const { data: deployments } = useDeployments(campaignId);
  const [justPublished, setJustPublished] = useState<string | null>(null);

  const blocked = blockers.length > 0;

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">Publicação</p>
          <p className="mt-1 text-sm text-text-muted">
            Publicar congela a versão atual. Alterar a campanha depois disso não muda o que está no
            ar — exige publicar de novo.
          </p>
        </div>

        <Button
          size="sm"
          disabled={blocked}
          loading={publish.isPending}
          onClick={() =>
            publish.mutate(undefined, {
              onSuccess: (result) => setJustPublished(result.publicId),
            })
          }
        >
          <Globe aria-hidden className="size-4" />
          {deploymentNumber ? 'Publicar de novo' : 'Publicar'}
        </Button>
      </div>

      {blocked && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-start gap-2 text-[13px] text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{blocker}</span>
            </li>
          ))}
        </ul>
      )}

      {publish.isError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {publish.error instanceof Error ? publish.error.message : 'Não foi possível publicar.'}
        </p>
      )}

      {(publicId ?? justPublished) && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <ExternalLink aria-hidden className="size-3.5" />
          {/* Abre em outra aba: é a tela do PÚBLICO, e quem publica precisa
              conferir o que o cliente dele vai ver sem perder o painel. */}
          <a
            href={`/c/${publicId ?? justPublished}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-accent hover:underline"
          >
            /c/{publicId ?? justPublished}
          </a>
          <span className="text-text-subtle">— serve a versão publicada, não a atual.</span>
        </p>
      )}

      {deployments && deployments.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4">
          {deployments.map((deployment) => (
            <li key={deployment.id} className="flex items-baseline gap-3 text-[13px]">
              <span className="font-mono text-[11px] text-text-subtle">
                #{deployment.deploymentNumber}
              </span>
              <Badge tone={deployment.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {deployment.status === 'ACTIVE' ? 'no ar' : 'substituída'}
              </Badge>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle"
                title={deployment.manifestHash}
              >
                {deployment.manifestHash.slice(0, 12)}
              </span>
              <span className="shrink-0 text-xs text-text-subtle">
                {new Date(deployment.publishedAt).toLocaleDateString('pt-BR')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CampaignPage() {
  const { campaignId } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);
  const { data: versions } = useCampaignVersions(campaignId);
  const { open } = useHub();

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (isError || !campaign) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Campanha não encontrada.
          </p>
        </Card>
      </div>
    );
  }

  const strategy = campaign.strategy?.canonical;
  const hasItems = strategy ? FACET_ORDER.some((facet) => strategy[facet].length > 0) : false;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          {strategy?.identity.summary && (
            <p className="mt-1 text-sm text-text-muted">{strategy.identity.summary}</p>
          )}
          {campaign.strategy && (
            <p className="mt-1 text-xs text-text-subtle">
              versão {campaign.strategy.versionNumber}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={open}>
          <Sparkles aria-hidden className="size-4" />
          Ajustar
        </Button>
      </div>

      <HeroImageField campaignId={campaign.id} heroImageUrl={campaign.heroImageUrl} />

      {strategy?.goal.primary && (
        <Card className="mt-5 p-5">
          <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">Objetivo</p>
          <p className="mt-1.5 text-sm leading-relaxed">{strategy.goal.primary}</p>
          {strategy.goal.successCriteria.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {strategy.goal.successCriteria.map((criterion) => (
                <li key={criterion} className="text-[13px] text-text-muted">
                  · {criterion}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <AgentBinding
        campaignId={campaign.id}
        projectId={campaign.projectId}
        currentAgentId={campaign.agentId}
      />

      <Publication
        campaignId={campaign.id}
        blockers={campaign.publishBlockers}
        publicId={campaign.publicId}
        deploymentNumber={campaign.activeDeployment?.deploymentNumber ?? null}
      />

      {strategy && <CtaForm campaignId={campaign.id} cta={strategy.cta} />}

      {strategy && !hasItems && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Esta campanha ainda não tem público nem dimensões de descoberta. Abra o MyAIHub e
            descreva com quem ela fala e o que o agente precisa entender antes de propor.
          </p>
        </Card>
      )}

      {strategy &&
        FACET_ORDER.map((facet) => (
          <EditableFacet
            key={facet}
            label={CAMPAIGN_FACET_LABELS[facet]}
            items={strategy[facet]}
            resource="campaigns"
            entityId={campaign.id}
            upsertKind={CAMPAIGN_FACET_MUTATION[facet]}
            removeKind={CAMPAIGN_REMOVE_MUTATION}
            facet={facet}
            semanticPrefix={CAMPAIGN_SEMANTIC_KEY_PREFIXES[facet]}
          />
        ))}

      {versions && versions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[12.5px] font-semibold tracking-tight text-text-subtle">Histórico</h2>
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
