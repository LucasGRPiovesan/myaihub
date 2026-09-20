import { assessAgent, type CanonicalAgent, type HealthCheck } from '@myaihub/shared';
import { AlertCircle, Check, CircleDashed } from 'lucide-react';
import { Card, cx } from '../../design-system/primitives';

/**
 * Diagnóstico do agente, sem maquiagem.
 *
 * A nota existe para responder "posso colocar isto no ar?" — por isso o que
 * aparece em destaque é o que FALTA, não o número. Um medidor que mostra 72%
 * em verde e esconde os itens vermelhos treina o usuário a ignorar medidores.
 *
 * Tudo aqui é função pura sobre o canônico: não custa token e responde igual
 * toda vez. Perguntar ao modelo "está bom?" daria uma nota diferente por
 * chamada, e um diagnóstico que muda de ideia sozinho não é diagnóstico.
 */

const TONE: Record<HealthCheck['status'], { icon: typeof Check; className: string }> = {
  ok: { icon: Check, className: 'text-success' },
  warn: { icon: AlertCircle, className: 'text-warning' },
  missing: { icon: CircleDashed, className: 'text-danger' },
};

export function AgentHealthCard({ agent }: { agent: CanonicalAgent }) {
  const health = assessAgent(agent);
  // Cinza acima de 80, âmbar no meio, vermelho embaixo. Verde vibrante numa
  // configuração meia-boca seria elogio que o dado não sustenta.
  const bar = health.score >= 80 ? 'bg-success' : health.score >= 50 ? 'bg-warning' : 'bg-danger';

  const pending = health.checks.filter((check) => check.status !== 'ok');

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
          Prontidão
        </p>
        <p className="text-2xl font-semibold tabular-nums">{health.score}</p>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cx('h-full rounded-full transition-all', bar)}
          style={{ width: `${health.score}%` }}
        />
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-text-muted">
        {health.publishable
          ? `${health.items} ${health.items === 1 ? 'item configurado' : 'itens configurados'}. Pronto para publicar.`
          : 'Falta o essencial para colocar no ar.'}
      </p>

      {pending.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          {pending.map((check) => {
            const { icon: Icon, className } = TONE[check.status];
            return (
              <li key={check.id} className="flex items-start gap-2 text-[13px]">
                <Icon aria-hidden className={cx('mt-0.5 size-3.5 shrink-0', className)} />
                <span className="min-w-0">
                  <span className="font-medium">{check.label}</span>
                  <span className="text-text-muted"> — {check.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {pending.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-[13px] text-success">
          <Check aria-hidden className="size-3.5" />
          Nada pendente.
        </p>
      )}
    </Card>
  );
}
