import { Plus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { useHub } from '../hub/HubProvider';
import { useAgents } from './agents.api';

export function AgentsPage() {
  const { data: agents, isPending, isError } = useAgents();
  const { open } = useHub();

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
        <Card className="mt-5 p-6">
          <SkeletonText lines={4} />
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
        <Card className="mt-5 p-6">
          <p role="alert" className="text-sm text-danger">
            Não foi possível carregar seus agentes. Recarregue a página.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
          <p className="mt-1 text-sm text-text-muted">
            Agentes pertencem à conta e podem atuar em qualquer projeto.
          </p>
        </div>
        {agents.length > 0 && (
          <Button size="sm" onClick={open}>
            <Plus aria-hidden className="size-4" />
            Novo agente
          </Button>
        )}
      </div>

      {agents.length === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={Users}
            title="Nenhum agente ainda"
            description="Descreva o agente que você quer — quem ele é, o que sabe fazer, como deve conversar. O MyAIHub transforma isso em configuração, sem você precisar escrever prompt."
            action={
              <Button onClick={open}>
                <Plus aria-hidden className="size-4" />
                Criar meu primeiro agente
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {agents.map((agent, index) => (
            <li key={agent.id}>
              <Link
                to={`/agentes/${agent.id}`}
                className="flex items-baseline gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-sunken"
              >
                <span className="font-mono text-[11px] text-text-subtle">
                  #{agents.length - index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{agent.name}</span>
                  <span className="block truncate text-xs text-text-subtle">{agent.role}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
