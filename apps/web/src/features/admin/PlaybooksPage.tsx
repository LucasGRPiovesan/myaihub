import { BookOpen, ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, EmptyState, SkeletonText } from '../../design-system/feedback';
import { Card } from '../../design-system/primitives';
import { usePlaybookMisses, usePlaybooks } from './admin.api';

/**
 * Playbooks de ofício, a tela do admin da plataforma.
 *
 * O que o admin edita aqui é o PISO profissional que todo agente daquele papel
 * herda, em qualquer conta. Por isso a tela mostra duas coisas lado a lado: o
 * que já existe, e — mais importante — os papéis que chegaram e não tinham
 * playbook. A segunda lista é a pauta: sem ela, a lacuna é invisível e o agente
 * nasce genérico sem ninguém ficar sabendo.
 */
export function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Misses() {
  const { data: misses, isPending } = usePlaybookMisses();

  if (isPending) {
    return (
      <Card className="p-5">
        <SkeletonText lines={3} />
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-text-subtle">
        <TriangleAlert aria-hidden className="size-3.5" />
        Sem playbook
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
        Papéis que alguém pediu e o OS teve que projetar sozinho, do mais frequente para o menos. É
        a fila do que vale escrever a seguir.
      </p>

      {!misses || misses.length === 0 ? (
        <p className="mt-4 text-[13px] text-text-subtle">
          Nenhum por enquanto — todo papel pedido até agora tinha ofício.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {misses.map((miss) => (
            <li
              key={miss.role}
              className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px]">{miss.role}</p>
                <p className="mt-0.5 text-[11px] text-text-subtle">{relativeDate(miss.lastSeen)}</p>
              </div>
              <span className="shrink-0 text-[13px] font-medium tabular-nums">{miss.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PlaybooksPage() {
  const { data: playbooks, isPending, isError } = usePlaybooks();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Playbooks de ofício</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            O que faz alguém ser bom em cada papel. O OS usa isto para projetar agentes — vale para
            todas as contas, e não aparece para quem usa a plataforma.
          </p>
        </div>
        <Link
          to="/admin/playbooks/novo"
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <Plus aria-hidden className="size-4" />
          Novo playbook
        </Link>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-3">
          {isPending && (
            <Card className="p-6">
              <SkeletonText lines={4} />
            </Card>
          )}

          {isError && (
            <Card className="p-6">
              <p role="alert" className="text-sm text-danger">
                Não foi possível carregar os playbooks. Recarregue a página.
              </p>
            </Card>
          )}

          {playbooks?.length === 0 && (
            <EmptyState
              icon={BookOpen}
              title="Nenhum playbook ainda"
              description="Sem playbook, o OS projeta o agente com o que o modelo por acaso souber do papel — que é raso e muda a cada criação."
            />
          )}

          {playbooks?.map((playbook) => (
            <Link
              key={playbook.key}
              to={`/admin/playbooks/${playbook.key}`}
              className="group rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {playbook.label}
                    {playbook.key.startsWith('core.') && <Badge tone="accent">piso</Badge>}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-subtle">{playbook.key}</p>
                </div>
                <ChevronRight
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-text-subtle transition-colors group-hover:text-text"
                />
              </div>

              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted tabular-nums">
                <span>{playbook.principles} princípios</span>
                <span>{playbook.antiPatterns} limites</span>
                <span>{playbook.questions} perguntas</span>
                <span className={playbook.agents > 0 ? 'text-text' : undefined}>
                  {playbook.agents} {playbook.agents === 1 ? 'agente' : 'agentes'}
                </span>
                <span className="text-text-subtle">
                  v{playbook.versionNumber} · {relativeDate(playbook.updatedAt)}
                </span>
              </p>
            </Link>
          ))}
        </div>

        <Misses />
      </div>
    </div>
  );
}
