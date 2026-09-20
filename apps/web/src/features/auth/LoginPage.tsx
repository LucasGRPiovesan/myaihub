import { registerRequestSchema } from '@myaihub/shared';
import {
  BarChart3,
  BookOpen,
  Boxes,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Field, Input } from '../../design-system/primitives';
import { ThemeToggle } from '../../design-system/ThemeToggle';
import { ApiError } from '../../lib/api-client';
import { useLogin, useRegister } from './auth.api';

type Mode = 'login' | 'register';

/** Mesmo vocabulário de ícone da sidebar (`navigation.ts`) — o índice do
 * painel esquerdo não inventa outro léxico visual para as mesmas quatro
 * seções. */
const AREAS = [
  { label: 'Projetos', description: 'O negócio, documentado uma vez.', icon: Boxes },
  { label: 'Agentes', description: 'Quem conversa em nome dele.', icon: Users },
  { label: 'Playbooks', description: 'O ofício de cada papel, curado.', icon: BookOpen },
  { label: 'Resultados', description: 'O que aconteceu, sem estimativa.', icon: BarChart3 },
] as const;

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
      O portão é a única tela FORA do shell, então a rolagem dela é sua. Cada
      coluna rola por conta própria — numa janela baixa, o painel editorial
      pode cortar sem levar o formulário junto, que é a metade que precisa do
      botão sempre alcançável.
    */
    <main className="grid h-full lg:grid-cols-[minmax(0,1fr)_472px]">
      {/*
        O painel esquerdo é o ÍNDICE do produto, não decoração: as mesmas
        quatro seções da sidebar (`navigation.ts`), com o mesmo ícone — quem
        entra aqui está prestes a ver exatamente isto. Escondido no celular
        porque ali a tela inteira é do formulário.
      */}
      <section className="relative hidden overflow-hidden border-border border-r bg-surface-sunken lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <Sparkles
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-[420px] text-accent opacity-[0.05]"
          strokeWidth={0.75}
        />

        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-accent text-white">
            <Sparkles aria-hidden className="size-[18px]" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">MyAIHub</span>
        </div>

        <div className="max-w-[30rem]">
          <h1 className="text-[28px] leading-[1.25] font-semibold tracking-tight text-balance">
            O hub de operações com IA do seu negócio.
          </h1>
          <p className="mt-3 text-[15px] text-text-muted">
            Um lugar só para o que a IA sabe sobre o seu negócio, quem fala em
            nome dele e o que essas conversas de fato produziram.
          </p>

          <dl className="mt-10 flex flex-col gap-5 border-t border-border pt-8">
            {AREAS.map((area) => (
              <div key={area.label} className="flex items-start gap-3.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border text-text-subtle">
                  <area.icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                  <dt className="text-sm font-medium">{area.label}</dt>
                  <dd className="text-[13px] text-text-muted">{area.description}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <p className="font-mono text-[12px] text-text-subtle">
          myaihub — plataforma de operações com IA
        </p>
      </section>

      <section className="flex items-center justify-center overflow-y-auto px-4 py-12 sm:px-10">
        <div className="w-full max-w-[368px]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-accent text-white">
                <Sparkles aria-hidden className="size-[18px]" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">MyAIHub</span>
            </div>
            <ThemeToggle />
          </div>
          <div className="mb-8 hidden justify-end lg:flex">
            <ThemeToggle />
          </div>

          <Card className="p-7">
            <h2 className="text-xl font-semibold tracking-tight">
              {mode === 'login' ? 'Entrar' : 'Criar conta'}
            </h2>
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
                    className="group flex items-center gap-3 rounded-[var(--radius-control)] border border-border p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent">
                      <user.icon aria-hidden className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{user.name}</span>
                      <span className="block truncate text-[13px] text-text-muted">
                        {user.role}
                      </span>
                    </span>
                    <span className="text-[13px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                      Entrar
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
      </section>
    </main>
  );
}
