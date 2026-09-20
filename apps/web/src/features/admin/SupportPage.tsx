import { CircleCheck, LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { Badge, EmptyState, SkeletonText } from '../../design-system/feedback';
import { Button, Card, cx } from '../../design-system/primitives';
import { relativeDate } from './PlaybooksPage';
import { useResolveLimitation, useSystemLimitations, type SystemLimitation } from './admin.api';

/**
 * A pauta de SUPORTE do MyAIHub.
 *
 * Cada item é um pedido que o S.O não conseguiu atender por limite do SISTEMA
 * — não do pedido, não da configuração do usuário. A correção é no produto, e
 * sem esta tela a limitação ficava numa frase educada da resposta e morria ali.
 *
 * Resolver exige dizer O QUE foi feito: é o que responde a quem esbarrar no
 * mesmo limite depois, e o que separa "resolvido" de "sumiu da lista".
 */
function LimitationCard({ item }: { item: SystemLimitation }) {
  const resolver = useResolveLimitation();
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState('');

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-medium leading-snug">{item.summary}</p>
        <span className="shrink-0 text-[11px] text-text-subtle">
          {relativeDate(item.createdAt)}
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
        <span className="font-medium text-text">O que falta: </span>
        {item.need}
      </p>

      <blockquote className="mt-3 rounded-[var(--radius-control)] border-l-2 border-border bg-surface-sunken px-3 py-2 text-[12px] whitespace-pre-wrap text-text-muted">
        {item.userMessage}
      </blockquote>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-subtle">
        <Badge tone="neutral">{item.operation}</Badge>
        <span className="font-mono">conta {item.accountId.slice(-6)}</span>
      </div>

      {item.status === 'RESOLVED' ? (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-success">
          <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{item.resolutionNote}</span>
        </p>
      ) : aberto ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            resolver.mutate({ id: item.id, note: nota.trim() });
          }}
        >
          <label htmlFor={`nota-${item.id}`} className="text-[12px] font-medium text-text-muted">
            O que foi feito no MyAIHub
          </label>
          <textarea
            id={`nota-${item.id}`}
            value={nota}
            onChange={(event) => setNota(event.target.value)}
            rows={2}
            className="w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] focus:border-border-strong"
          />
          {resolver.isError && (
            <p role="alert" className="text-[12px] text-danger">
              Não foi possível marcar como resolvido.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              loading={resolver.isPending}
              disabled={nota.trim().length < 3}
            >
              Marcar como resolvido
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="mt-3 text-[12px] font-medium text-accent hover:underline"
        >
          Resolver
        </button>
      )}
    </Card>
  );
}

export function SupportPage() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const { data: items, isPending, isError } = useSystemLimitations(status);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Suporte</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-muted">
        O que o S.O não conseguiu fazer por limite do sistema, em todas as contas. Cada item é uma
        correção a fazer no MyAIHub — não na configuração de quem pediu.
      </p>

      <div role="tablist" aria-label="Situação" className="mt-5 flex gap-1">
        {(['OPEN', 'RESOLVED'] as const).map((valor) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={status === valor}
            onClick={() => setStatus(valor)}
            className={cx(
              'rounded-full px-3 py-1 text-[13px] transition-colors',
              status === valor
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-text-muted hover:text-text',
            )}
          >
            {valor === 'OPEN' ? 'Em aberto' : 'Resolvidos'}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {isPending && (
          <Card className="p-5">
            <SkeletonText lines={3} />
          </Card>
        )}
        {isError && (
          <Card className="p-5">
            <p role="alert" className="text-sm text-danger">
              Não foi possível carregar a pauta. Recarregue a página.
            </p>
          </Card>
        )}
        {items?.length === 0 && (
          <EmptyState
            icon={LifeBuoy}
            title={status === 'OPEN' ? 'Nada em aberto' : 'Nada resolvido ainda'}
            description={
              status === 'OPEN'
                ? 'Até agora o S.O conseguiu fazer tudo o que pediram — ou disse o que faltava na própria configuração.'
                : 'Os itens resolvidos aparecem aqui com o que foi feito.'
            }
          />
        )}
        {items?.map((item) => (
          <LimitationCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
