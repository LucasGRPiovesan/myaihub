import { Boxes, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { useHub } from '../hub/HubProvider';
import { useProjects } from './projects.api';

export function ProjectsPage() {
  const { data: projects, isPending, isError } = useProjects();
  const { open } = useHub();

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
        <Card className="mt-5 p-6">
          <SkeletonText lines={4} />
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
        <Card className="mt-5 p-6">
          <p role="alert" className="text-sm text-danger">
            Não foi possível carregar seus projetos. Recarregue a página.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
        {projects.length > 0 && (
          <Button size="sm" onClick={open}>
            <Plus aria-hidden className="size-4" />
            Novo projeto
          </Button>
        )}
      </div>

      {projects.length === 0 ? (
        <Card className="mt-5">
          {/*
            Estado vazio que RESOLVE: abre o painel do MyAIHub, que é onde o
            projeto de fato nasce. Um estado vazio sem saída é só uma tela morta.
          */}
          <EmptyState
            icon={Boxes}
            title="Nenhum projeto ainda"
            description="Um projeto é o workspace do seu negócio: perfil, conhecimento e campanhas vivem dentro dele. Descreva seu negócio para o MyAIHub e ele estrutura o resto."
            action={
              <Button onClick={open}>
                <Plus aria-hidden className="size-4" />
                Criar meu primeiro projeto
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projetos/${project.id}`}
                className="block rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-sunken"
              >
                <p className="text-sm font-medium">{project.name}</p>
                <p className="mt-0.5 text-xs text-text-subtle">{project.slug}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
