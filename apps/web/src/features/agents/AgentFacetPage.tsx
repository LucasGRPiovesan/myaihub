import {
  AGENT_FACET_LABELS,
  AGENT_FACET_MUTATION,
  AGENT_REMOVE_MUTATION,
  AGENT_SEMANTIC_KEY_PREFIXES,
  facetFromSlug,
} from '@myaihub/shared';
import { Sparkles } from 'lucide-react';
import { useParams } from 'react-router';
import { SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { EditableFacet } from '../canonical/EditableFacet';
import { useHub } from '../hub/HubProvider';
import { useAgent } from './agents.api';

/**
 * Uma faceta do agente, em rota própria.
 *
 * Sete facetas numa página só faziam o usuário rolar metros para chegar em
 * "limites" — e o painel do OS ao lado ocupa um quarto da tela. Separadas, cada
 * uma cabe na vista, e a sidebar mostra de relance qual está vazia.
 */
export function AgentFacetPage() {
  const { agentId, facet: slug } = useParams();
  const { data: agent, isPending, isError } = useAgent(agentId);
  const { open } = useHub();

  const facet = slug ? facetFromSlug(slug) : null;

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={5} />
      </div>
    );
  }

  if (isError || !agent || !facet) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            {facet ? 'Agente não encontrado.' : 'Seção não encontrada.'}
          </p>
        </Card>
      </div>
    );
  }

  const config = agent.configuration?.canonical;
  const items = config?.[facet] ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {AGENT_FACET_LABELS[facet]}
          </h1>
          <p className="mt-1 truncate text-sm text-text-muted">{agent.name}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={open}>
          <Sparkles aria-hidden className="size-4" />
          Ajustar
        </Button>
      </div>

      {items.length === 0 && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Nada configurado aqui ainda. Descreva no MyAIHub o que você quer, ou adicione à mão
            abaixo — as duas formas geram a mesma configuração.
          </p>
        </Card>
      )}

      <EditableFacet
        label={AGENT_FACET_LABELS[facet]}
        items={items}
        resource="agents"
        entityId={agent.id}
        upsertKind={AGENT_FACET_MUTATION[facet]}
        removeKind={AGENT_REMOVE_MUTATION}
        facet={facet}
        semanticPrefix={AGENT_SEMANTIC_KEY_PREFIXES[facet]}
      />
    </div>
  );
}
