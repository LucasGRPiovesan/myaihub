import { ChevronLeft, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { cx } from '../../design-system/primitives';
import { resolveNavLevel, type NavContext, type NavLevel } from './navigation';

function LevelContent({ level }: { level: NavLevel }) {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        {level.back ? (
          <Link
            to={level.back.to}
            className="flex min-w-0 items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
          >
            <ChevronLeft aria-hidden className="size-5 shrink-0" />
            <span className="truncate">{level.back.label}</span>
          </Link>
        ) : (
          <>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <Sparkles aria-hidden className="size-5" />
            </span>
            <span className="truncate text-base font-semibold tracking-tight">{level.title}</span>
          </>
        )}
      </div>

      {level.depth > 0 && (
        <p className="truncate px-4 pb-2.5 text-base font-semibold tracking-tight">{level.title}</p>
      )}

      <nav aria-label="Navegação da seção" className="flex flex-col gap-1 px-2">
        {level.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-[15px] transition-colors',
                isActive
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-text-muted hover:bg-surface-sunken hover:text-text',
              )
            }
          >
            <item.icon aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && (
              // Apagado quando é zero: o que está vazio precisa parecer vazio,
              // sem virar alarme.
              <span
                className={cx(
                  'shrink-0 text-[12px] tabular-nums',
                  item.badge === 0 ? 'text-text-subtle' : 'text-text-muted',
                )}
              >
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

/**
 * Sidebar empilhada (§29).
 *
 * Ao entrar num projeto ou campanha, o nível anterior sai para a esquerda e o
 * novo entra pela direita — navegação em pilha, não troca seca de menu. Voltar
 * inverte o sentido.
 *
 * A animação é CSS puro sobre a montagem/desmontagem de um único nível: manter
 * dois níveis vivos ao mesmo tempo duplicaria links focáveis no DOM, o que
 * confunde navegação por teclado e leitor de tela. O ganho visual não paga esse
 * preço.
 */
export function StackedSidebar({ context }: { context?: NavContext }) {
  const { pathname } = useLocation();
  const level = resolveNavLevel(pathname, context);

  const previousDepth = useRef(level.depth);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  useEffect(() => {
    setDirection(level.depth >= previousDepth.current ? 'forward' : 'backward');
    previousDepth.current = level.depth;
  }, [level.depth]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        // A key remonta o bloco a cada mudança de nível — é o que dispara a
        // animação de entrada.
        key={level.id}
        className={cx(
          'flex flex-1 flex-col',
          direction === 'forward' ? 'animate-[nav-in-right]' : 'animate-[nav-in-left]',
        )}
        style={{ animationDuration: '220ms', animationTimingFunction: 'var(--ease-out-soft)' }}
      >
        <LevelContent level={level} />
      </div>
    </div>
  );
}
