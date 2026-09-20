import type { ModelRole, ProviderName } from '@myaihub/shared';
import { Lock } from 'lucide-react';
import { cx } from '../../design-system/primitives';
import { useCurrentUser } from '../auth/auth.api';
import { useModelSettings, useSetModelRoute } from './models.api';

/**
 * Provider e modelo, ao lado do chat — como em qualquer interface de IA.
 *
 * Aparece só para quem administra a PLATAFORMA. Trocar o modelo muda o custo e
 * o comportamento de TODAS as contas, então não é escolha de quem usa: é a
 * mesma fronteira do playbook, que o dono de uma conta também não edita.
 *
 * A escolha é por PAPEL, e não por conversa. O papel já é a abstração que o
 * sistema inteiro usa ("quem responde `agent.runtime`?"), e amarrar o modelo a
 * uma conversa criaria um segundo lugar guardando a mesma decisão — com a
 * garantia de divergirem na primeira tela que esquecesse de atualizar.
 */
export function ModelPicker({ role, className }: { role: ModelRole; className?: string }) {
  const { data: user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const { data: settings } = useModelSettings(isAdmin);
  const setRoute = useSetModelRoute();

  if (!isAdmin || !settings) return null;

  const atual = settings.roles.find((item) => item.role === role);
  if (!atual) return null;

  const travado = settings.lockedToFreeTier;
  const escolhido = travado ? atual.effective : atual.selected;
  const provider = settings.providers.find((item) => item.provider === escolhido.provider);

  function trocarProvider(nome: ProviderName): void {
    const alvo = settings?.providers.find((item) => item.provider === nome);
    // Ao trocar de provider, o modelo vai para o PRIMEIRO dele: manter o
    // modelo anterior mandaria um id de outro provider, que a API recusa.
    const primeiro = alvo?.models[0];
    if (primeiro) setRoute.mutate({ role, provider: nome, model: primeiro.id });
  }

  return (
    <div className={cx('flex items-center gap-1.5', className)}>
      {travado && (
        <span
          title={
            'A cota gratuita do Gemini está disponível — enquanto ela durar, o sistema usa ' +
            'o modelo que ela serve. Gastar num modelo pago tendo requisição gratuita seria ' +
            'queimar dinheiro por opção de tela. A escolha volta a valer quando a cota acabar.'
          }
          className="flex items-center gap-1 text-[11px] text-text-subtle"
        >
          <Lock aria-hidden className="size-3" />
        </span>
      )}

      <label className="sr-only" htmlFor={`provider-${role}`}>
        Provider de IA
      </label>
      <select
        id={`provider-${role}`}
        value={escolhido.provider}
        disabled={travado || setRoute.isPending}
        onChange={(event) => trocarProvider(event.target.value as ProviderName)}
        className={cx(
          'rounded-[var(--radius-control)] border border-border bg-surface px-1.5 py-0.5',
          'text-[11px] text-text-muted disabled:opacity-60',
        )}
      >
        {settings.providers.map((item) => (
          // Provider sem chave aparece, desligado, com o motivo: esconder daria
          // a entender que ele não existe, quando o que falta é uma variável.
          <option key={item.provider} value={item.provider} disabled={!item.available}>
            {item.label}
            {item.available ? '' : ` (sem ${item.envKey})`}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor={`model-${role}`}>
        Modelo
      </label>
      <select
        id={`model-${role}`}
        value={escolhido.model}
        disabled={travado || setRoute.isPending}
        onChange={(event) =>
          setRoute.mutate({ role, provider: escolhido.provider, model: event.target.value })
        }
        className={cx(
          'rounded-[var(--radius-control)] border border-border bg-surface px-1.5 py-0.5',
          'text-[11px] text-text-muted disabled:opacity-60',
        )}
      >
        {(provider?.models ?? []).map((modelo) => (
          <option key={modelo.id} value={modelo.id} title={modelo.note}>
            {modelo.label}
          </option>
        ))}
      </select>
    </div>
  );
}
