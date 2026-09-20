import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// -----------------------------------------------------------------------------
// Button
// -----------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover disabled:hover:bg-accent shadow-[0_1px_2px_rgb(0_0_0/0.08)]',
  secondary:
    'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-sunken',
  ghost: 'text-text-muted hover:text-text hover:bg-surface-sunken',
  danger: 'bg-danger text-white hover:opacity-90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] font-medium',
        'transition-colors duration-150 ease-[var(--ease-out-soft)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

// -----------------------------------------------------------------------------
// IconButton
// -----------------------------------------------------------------------------

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size'> {
  /** Obrigatório: um botão só com ícone não tem nome acessível sem isto. */
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      className={cx('size-8 px-0', className)}
      {...rest}
    >
      {children}
    </Button>
  );
});

// -----------------------------------------------------------------------------
// Field / Input
// -----------------------------------------------------------------------------

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[13px] text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        'h-10 w-full rounded-[var(--radius-control)] border bg-surface px-3 text-sm text-text',
        'placeholder:text-text-subtle transition-colors duration-150',
        invalid ? 'border-danger' : 'border-border hover:border-border-strong',
        className,
      )}
      {...rest}
    />
  );
});

// -----------------------------------------------------------------------------
// Switch
// -----------------------------------------------------------------------------

export interface SwitchProps {
  checked: boolean;
  /** Ausente = o switch é só ESTADO — o valor muda por si, nunca por clique. */
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Nome acessível. Sem rótulo visível ao lado, é ele que diz o que liga/desliga. */
  label: string;
  className?: string;
}

/**
 * Um toggle, não um botão de duas cores.
 *
 * Usado tanto para ESCOLHA (ligar/desligar um provider) quanto para ESTADO
 * (qual cota está servindo agora, sem `onChange` — o usuário não escolhe isso,
 * o sistema troca sozinho quando a cota do dia acaba). Nos dois casos a forma
 * visual é a mesma; o que muda é só existir ou não um clique por trás dela.
 */
export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  const interativo = Boolean(onChange) && !disabled;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled || !onChange}
      onClick={() => onChange?.(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150',
        checked ? 'bg-accent' : 'bg-surface-sunken',
        interativo ? 'cursor-pointer' : 'cursor-default',
        disabled && 'opacity-60',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'inline-block size-3.5 rounded-full bg-surface shadow-[var(--shadow-card)] transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
