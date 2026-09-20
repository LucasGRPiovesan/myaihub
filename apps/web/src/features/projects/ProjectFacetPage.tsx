import {
  PROJECT_BINDING_FACET,
  PROJECT_FACET_DESCRIPTIONS,
  PROJECT_FACET_LABELS,
  PROJECT_FACET_MUTATION,
  PROJECT_REMOVE_MUTATION,
  PROJECT_SEMANTIC_KEY_PREFIXES,
  projectFacetFromSlug,
} from '@myaihub/shared';
import { ShieldAlert, Sparkles } from 'lucide-react';
import { useParams } from 'react-router';
import { SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { EditableFacet } from '../canonical/EditableFacet';
import { useHub } from '../hub/HubProvider';
import { useProject } from './projects.api';

/**
 * Uma seção do perfil do projeto, em rota própria.
 *
 * Mesma decisão das facetas do agente: seis seções numa página só produzem a
 * rolagem de dois mil pixels que já custou caro aqui, e sem nível na sidebar
 * não dá para saber onde se está nem chegar direto.
 */
export function ProjectFacetPage() {
  const { projectId, facet: slug } = useParams();
  const { data: project, isPending, isError } = useProject(projectId);
  const { open } = useHub();

  const facet = slug ? projectFacetFromSlug(slug) : null;

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={5} />
      </div>
    );
  }

  if (isError || !project || !facet) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            {facet ? 'Projeto não encontrado.' : 'Seção não encontrada.'}
          </p>
        </Card>
      </div>
    );
  }

  const profile = project.profile?.canonical;
  const items = profile?.[facet] ?? [];
  const vinculante = facet === PROJECT_BINDING_FACET;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {PROJECT_FACET_LABELS[facet]}
          </h1>
          <p className="mt-1 truncate text-sm text-text-muted">{project.name}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={open}>
          <Sparkles aria-hidden className="size-4" />
          Ajustar
        </Button>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-text-muted">
        {PROJECT_FACET_DESCRIPTIONS[facet]}
      </p>

      {/*
        A única seção do perfil com efeito de runtime merece dizer isso na cara.
        Sem o aviso, "obrigatória" parece um rótulo de organização — e o usuário
        não teria como saber que marcar assim muda o que o agente responde.
      */}
      {vinculante && (
        <Card className="mt-4 flex items-start gap-3 p-4">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
          <p className="text-[13px] leading-relaxed text-text-muted">
            Regra marcada como <strong className="font-medium text-text">obrigatória</strong> entra
            nas regras inegociáveis de todo agente que atua neste projeto — acima da personalidade,
            da estratégia e do que a campanha disser. As campanhas já publicadas continuam servindo
            a versão congelada até serem publicadas de novo.
          </p>
        </Card>
      )}

      {items.length === 0 && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Nada aqui ainda. Conte ao MyAIHub o que você sabe sobre isto, ou adicione à mão abaixo —
            as duas formas geram a mesma configuração.
          </p>
        </Card>
      )}

      <EditableFacet
        label={PROJECT_FACET_LABELS[facet]}
        items={items}
        resource="projects"
        entityId={project.id}
        upsertKind={PROJECT_FACET_MUTATION[facet]}
        removeKind={PROJECT_REMOVE_MUTATION}
        facet={facet}
        semanticPrefix={PROJECT_SEMANTIC_KEY_PREFIXES[facet]}
      />
    </div>
  );
}
