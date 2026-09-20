import type { AuthenticatedUser } from '@myaihub/shared';
import { Boxes, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, SkeletonText } from '../design-system/feedback';
import { Button, Card } from '../design-system/primitives';
import { useHub } from '../features/hub/HubProvider';
import { useProjects } from '../features/projects/projects.api';

export function OverviewPage({ user }: { user: AuthenticatedUser }) {
  const { data: projects, isPending } = useProjects();
  const { open } = useHub();
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={4} />
      </div>
    );
  }

  // Conta sem projeto: o MyAIHub é a tela, não um painel lateral (§12 do produto).
  if (!projects || projects.length === 0) {
    return (
      <div className="mx-auto flex h-full max-w-xl items-center justify-center">
        <Card className="w-full">
          <EmptyState
            icon={Sparkles}
            title={`Olá, ${firstName}`}
            description="Vamos criar seu primeiro projeto? Descreva seu negócio em uma ou duas frases — o MyAIHub cuida de transformar isso em configuração."
            action={
              <Button onClick={open}>
                <Sparkles aria-hidden className="size-4" />
                Criar novo projeto
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {projects.length === 1 ? '1 projeto ativo' : `${projects.length} projetos ativos`}
      </p>

      <ul className="mt-5 flex flex-col gap-2">
        {projects.slice(0, 5).map((project) => (
          <li key={project.id}>
            <Link
              to={`/projetos/${project.id}`}
              className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-sunken"
            >
              <Boxes aria-hidden className="size-4 shrink-0 text-text-subtle" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
