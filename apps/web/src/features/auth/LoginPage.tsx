import { registerRequestSchema } from '@myaihub/shared';
import { ShieldCheck, Sparkles, User as UserIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Field, Input } from '../../design-system/primitives';
import { ThemeToggle } from '../../design-system/ThemeToggle';
import { ApiError } from '../../lib/api-client';
import { useLogin, useRegister } from './auth.api';

type Mode = 'login' | 'register';

/**
 * Produto ainda em teste, sem uso real (pedido explícito do dono, 2026-09-20):
 * a tela de entrar troca o formulário por seleção de usuário — mesmas duas
 * contas da migração `20260921000000_seed_demo_users`. Credencial fixa e
 * visível de propósito; não introduza isto num produto com usuário real sem
 * reabrir essa decisão.
 */
const DEMO_USERS = [
  {
    email: 'admin@myaihub.local',
    password: 'Admin@123456',
    name: 'Administrador MyAIHub',
    role: 'Administrador da plataforma',
    icon: ShieldCheck,
  },
  {
    email: 'teste@myaihub.local',
    password: 'Teste@123456',
    name: 'Usuário Teste',
    role: 'Usuário comum',
    icon: UserIcon,
  },
] as const;

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const navigate = useNavigate();
  const login = useLogin();
  const register = useRegister();

  const pending = login.isPending || register.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const data = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = registerRequestSchema.safeParse(data);

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    try {
      await register.mutateAsync(parsed.data as never);
      void navigate('/', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Não foi possível concluir. Tente novamente.',
      );
    }
  }

  async function handleSelectUser(user: (typeof DEMO_USERS)[number]) {
    setFormError(null);
    try {
      await login.mutateAsync({ email: user.email, password: user.password });
      void navigate('/', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Não foi possível entrar. Tente novamente.',
      );
    }
  }

  return (
    /*
      O portão é a única tela FORA do shell, então a rolagem dela é sua.
      Com o documento travado, `min-h-full` sozinho cortaria o formulário numa
      janela baixa — e a tela de entrar é exatamente onde não se pode ficar sem
      alcançar o botão.
    */
    <main className="flex h-full items-center justify-center overflow-y-auto px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-accent text-white">
              <Sparkles aria-hidden className="size-[18px]" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">MyAIHub</span>
          </div>
          <ThemeToggle />
        </div>

        <Card className="p-7">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'login' ? 'Entrar' : 'Criar conta'}
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            {mode === 'login'
              ? 'Projeto em teste — escolha um acesso para entrar.'
              : 'Sua conta nasce pronta para receber projetos e agentes.'}
          </p>

          {mode === 'login' ? (
            <div className="mt-6 flex flex-col gap-2.5">
              {DEMO_USERS.map((user) => (
                <button
                  key={user.email}
                  type="button"
                  disabled={pending}
                  onClick={() => void handleSelectUser(user)}
                  className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border-subtle p-3 text-left transition-colors hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent">
                    <user.icon aria-hidden className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{user.name}</span>
                    <span className="block truncate text-[13px] text-text-muted">{user.role}</span>
                  </span>
                </button>
              ))}

              {formError && (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-[13px] text-danger"
                >
                  {formError}
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
              <Field label="Nome" htmlFor="name" error={fieldErrors['name']}>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder="Seu nome"
                  invalid={Boolean(fieldErrors['name'])}
                  aria-describedby={fieldErrors['name'] ? 'name-error' : undefined}
                />
              </Field>

              <Field label="E-mail" htmlFor="email" error={fieldErrors['email']}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@empresa.com"
                  invalid={Boolean(fieldErrors['email'])}
                  aria-describedby={fieldErrors['email'] ? 'email-error' : undefined}
                />
              </Field>

              <Field
                label="Senha"
                htmlFor="password"
                error={fieldErrors['password']}
                hint="Ao menos 10 caracteres, com maiúscula e número."
              >
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  invalid={Boolean(fieldErrors['password'])}
                  aria-describedby={fieldErrors['password'] ? 'password-error' : 'password-hint'}
                />
              </Field>

              {formError && (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-[13px] text-danger"
                >
                  {formError}
                </p>
              )}

              <Button type="submit" loading={pending} className="mt-1 w-full">
                Criar conta
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-5 text-center text-sm text-text-muted">
          {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setFieldErrors({});
              setFormError(null);
            }}
          >
            {mode === 'login' ? 'Criar agora' : 'Entrar'}
          </button>
        </p>
      </div>
    </main>
  );
}
