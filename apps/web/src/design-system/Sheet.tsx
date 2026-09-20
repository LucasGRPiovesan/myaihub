import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton, cx } from './primitives';

export type SheetSide = 'left' | 'right';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: SheetSide;
  title: string;
  /** Esconde o título visualmente, mantendo-o para leitores de tela. */
  hideTitle?: boolean;
  children: ReactNode;
}

/**
 * Painel deslizante para telas pequenas.
 *
 * Construído sobre `<dialog showModal()>` de propósito: o browser entrega
 * focus trap, `inert` no resto da página e fechamento por Esc de graça —
 * reimplementar isso à mão é justamente onde acessibilidade costuma quebrar.
 */
export function Sheet({ open, onClose, side = 'left', title, hideTitle, children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Esc dispara `cancel`; o estado é do React, então avisamos em vez de
    // deixar o dialog fechar por fora dele.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onClick={(event) => {
        // Clique no backdrop: o alvo é o próprio dialog, não o conteúdo.
        if (event.target === dialogRef.current) onClose();
      }}
      className={cx(
        'm-0 h-full max-h-none w-[min(19rem,85vw)] max-w-none bg-surface p-0 text-text',
        'backdrop:bg-[var(--color-overlay)]',
        side === 'left' ? 'mr-auto border-r' : 'ml-auto border-l',
        'border-border',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className={cx('text-sm font-semibold tracking-tight', hideTitle && 'sr-only')}>
            {title}
          </h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </dialog>
  );
}
