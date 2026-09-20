import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './primitives';

// -----------------------------------------------------------------------------
// Spinner
// -----------------------------------------------------------------------------

export function Spinner({
  label = 'Carregando',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className={cx(
          'block animate-spin rounded-full border-2 border-border border-t-accent',
          className ?? 'size-5',
        )}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------

/**
 * Placeholder de carregamento.
 *
 * `aria-hidden` de propósito: quem usa leitor de tela deve ouvir "carregando"
 * uma vez, vindo de um live region, e não a forma de cada retângulo.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('block animate-pulse rounded-md bg-surface-sunken', className ?? 'h-4 w-full')}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Carregando conteúdo">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Badge
// -----------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-surface-sunken text-success',
  warning: 'bg-surface-sunken text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// EmptyState
// -----------------------------------------------------------------------------

/**
 * Estado vazio. Diz o que existe, por que está vazio e qual é o próximo passo —
 * nunca uma caixa cinza sem saída (§43).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-[var(--radius-card)] bg-surface-sunken text-text-subtle">
        <Icon aria-hidden className="size-5" />
      </span>
      <h2 className="mt-4 text-[15px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
