import { formatCostMicros } from '@myaihub/shared';
import { MessageSquare, TriangleAlert, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Card, IconButton, cx } from '../../design-system/primitives';
import { useConversation, useConversations } from './conversations.api';

/**
 * As conversas por trás dos números.
 *
 * Um relatório que diz "3 violações de regra" sem deixar ler os três casos não
 * permite corrigir nada — e corrigir é o motivo de medir. Esta é a ponte entre
 * o agregado e o que de fato foi dito.
 *
 * O recorte é o mesmo do dashboard em que ela aparece, e só o canal PÚBLICO:
 * conversa de laboratório não é atendimento, e listá-la aqui encheria a tela de
 * teste de quem estava trabalhando.
 *
 * A seleção viaja em `?conversa=<id>`, e não em estado local: é o mesmo padrão
 * do `?regra=<code>` que o painel já usa para apontar um item. Assim a conversa
 * aberta é um endereço — dá para mandar para outra pessoa.
 */

function Turno({
  role,
  content,
  violations,
}: {
  role: 'VISITOR' | 'AGENT';
  content: string;
  violations: Array<{ check: string; message: string }>;
}) {
  return (
    <li className={cx('flex flex-col gap-1', role === 'VISITOR' ? 'items-end' : 'items-start')}>
      <p
        className={cx(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
          role === 'VISITOR' ? 'bg-accent text-accent-foreground' : 'bg-surface-sunken text-text',
        )}
      >
        {content}
      </p>

      {/* A violação fica COLADA na fala que a produziu. Numa lista à parte,
          ninguém liga uma coisa à outra — e é a ligação que ensina. */}
      {violations.map((violation) => (
        <p
          key={`${violation.check}-${violation.message}`}
          className="flex items-start gap-1.5 text-[12px] text-danger"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-mono">{violation.check}</span> — {violation.message}
          </span>
        </p>
      ))}
    </li>
  );
}

function Transcrito({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isPending, isError } = useConversation(id);

  return (
    <Card className="mt-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text">Conversa</p>
          {data && (
            <p className="mt-0.5 text-[12px] text-text-muted">
              {new Date(data.startedAt).toLocaleString('pt-BR')} · {data.messageCount} falas ·{' '}
              {formatCostMicros(data.costMicros)}
            </p>
          )}
        </div>
        <IconButton label="Fechar conversa" onClick={onClose}>
          <X aria-hidden className="size-4" />
        </IconButton>
      </div>

      {isPending && (
        <div className="mt-4">
          <SkeletonText lines={4} />
        </div>
      )}

      {isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          Não foi possível carregar esta conversa.
        </p>
      )}

      {data && (
        <>
          <ul className="mt-4 flex flex-col gap-3">
            {data.turns.map((turno, indice) => (
              <Turno
                key={`${turno.createdAt}-${indice}`}
                role={turno.role}
                content={turno.content}
                violations={turno.violations}
              />
            ))}
          </ul>

          {/* O que o modelo DECLAROU sobre a conversa, marcado como tal. Sem a
              marca, a leitura dele apareceria com a autoridade de uma medida. */}
          {(data.state.facts.length > 0 || data.state.signals.length > 0) && (
            <div className="mt-5 border-t border-border pt-3">
              <p className="text-[12px] tracking-tight text-text-subtle">
                O que o agente entendeu
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {data.state.facts.map((fato) => (
                  <li key={fato.key} className="text-[13px] text-text-muted">
                    <span className="font-mono text-[12px] text-text-subtle">{fato.key}</span>{' '}
                    {fato.value}
                  </li>
                ))}
                {data.state.signals.map((sinal) => (
                  <li key={`${sinal.kind}-${sinal.note}`} className="text-[13px] text-text-muted">
                    <span className="text-[12px] text-text-subtle">{sinal.kind}</span> {sinal.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ConversationsPanel({ campaignId }: { campaignId?: string | undefined }) {
  const [params, setParams] = useSearchParams();
  const selecionada = params.get('conversa');

  const { data, isPending } = useConversations({ channel: 'PUBLIC', campaignId });

  function abrir(id: string): void {
    const proximos = new URLSearchParams(params);
    proximos.set('conversa', id);
    setParams(proximos, { replace: true });
  }

  function fechar(): void {
    const proximos = new URLSearchParams(params);
    proximos.delete('conversa');
    setParams(proximos, { replace: true });
  }

  if (isPending) {
    return (
      <Card className="mt-4 p-5">
        <SkeletonText lines={3} />
      </Card>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <Card className="mt-4 p-5">
      <p className="text-[13px] font-medium text-text">Conversas</p>
      <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
        O que foi dito de fato. É aqui que um número do painel vira um caso para corrigir.
      </p>

      <ul className="mt-3 flex flex-col">
        {data.map((conversa) => (
          <li key={conversa.id}>
            <button
              type="button"
              onClick={() => (selecionada === conversa.id ? fechar() : abrir(conversa.id))}
              className={cx(
                'flex w-full items-center gap-3 border-t border-border px-1 py-2 text-left',
                selecionada === conversa.id ? 'text-text' : 'text-text-muted hover:text-text',
              )}
            >
              <MessageSquare aria-hidden className="size-4 shrink-0 text-text-subtle" />

              <span className="min-w-0 flex-1 truncate text-[13px]">
                {new Date(conversa.startedAt).toLocaleString('pt-BR')}
              </span>

              <span className="shrink-0 tabular-nums text-[12px]">
                {conversa.messageCount} falas
              </span>

              <span className="shrink-0 tabular-nums text-[12px] text-text-subtle">
                {formatCostMicros(conversa.costMicros)}
              </span>

              {conversa.violationCount > 0 && (
                <Badge tone="danger">{conversa.violationCount} violação(ões)</Badge>
              )}
            </button>
          </li>
        ))}
      </ul>

      {selecionada && <Transcrito id={selecionada} onClose={fechar} />}
    </Card>
  );
}
