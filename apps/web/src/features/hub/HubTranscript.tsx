import { AGENT_FACET_SLUGS, type AgentFacet } from '@myaihub/shared';
import {
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  Compass,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { cx } from '../../design-system/primitives';
import type { HubAttachmentRef, HubNotice, HubTraceLine } from './hub-state';
import { RichText } from './RichText';
import { costTitle, formatBrl } from '../usage/cost';
import { useSpend } from '../usage/usage.api';

/** O que um turno precisa para ser desenhado — em curso ou já arquivado. */
export interface TurnViewModel {
  request: string;
  attachments?: HubAttachmentRef[];
  understood?: string;
  operationLabel: string;
  answering: boolean;
  answer: string;
  notices: HubNotice[];
  questions: string[];
  entity: {
    id: string;
    name: string;
    target: string;
    touched?: Array<{ facet: string; code: string; label: string }>;
    playbook?: { key: string; label: string; versionNumber: number };
  } | null;
  costMicros: number;
  totalTokens: number;
  trace: HubTraceLine[];
  status: 'running' | 'completed' | 'failed';
}

// -----------------------------------------------------------------------------
// Pedido do usuário
// -----------------------------------------------------------------------------

/**
 * O pedido é um BALÃO, do lado de quem falou.
 *
 * Era uma faixa cinza da largura do painel, com o mesmo peso da resposta: o
 * transcrito virava um bloco de texto em que não se distinguia quem disse o
 * quê. As imagens ficam junto do pedido que elas explicam.
 */
function UserBubble({ text, attachments }: { text: string; attachments?: HubAttachmentRef[] }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[88%] flex-col items-end gap-1.5">
        {attachments && attachments.length > 0 && (
          <ul className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noreferrer" title={item.fileName}>
                  <img
                    src={item.url}
                    alt={item.fileName}
                    className="h-28 w-auto max-w-[240px] rounded-xl border border-border bg-surface object-cover object-top transition-opacity hover:opacity-90"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
        {text && (
          <p className="rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-text-inverted shadow-[var(--shadow-card)]">
            {text}
          </p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Enquanto trabalha
// -----------------------------------------------------------------------------

/**
 * O que está acontecendo AGORA, numa linha só.
 *
 * Substitui o checklist de dois itens genéricos ("Entendendo o pedido",
 * "Salvando nova versão"), que eram iguais em toda operação e não diziam nada
 * do que estava de fato em curso. A linha é a última coisa que o servidor
 * afirmou ter acontecido — nunca uma fase inventada.
 */
function WorkingLine({ label, trace }: { label: string; trace: HubTraceLine[] }) {
  const atual = trace.at(-1)?.text ?? (label ? `${label}…` : 'Lendo seu pedido…');

  return (
    <p aria-live="polite" className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-accent" />
      <span className="min-w-0 truncate">{atual}</span>
    </p>
  );
}

/**
 * O log do processo, recolhido.
 *
 * Continua existindo — é o que explica por que um turno custou o que custou —,
 * mas não disputa a leitura da resposta. Quem quer conferir abre.
 */
function ProcessLog({ lines }: { lines: HubTraceLine[] }) {
  return (
    <ol className="mt-2 flex flex-col gap-0.5 border-l border-border pl-3">
      {lines.map((line, indice) => (
        <li key={`${line.at}-${indice}`} className="flex gap-2 text-[11px] text-text-subtle">
          <span className="tabular-nums opacity-70">
            {new Date(line.at).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          <span className="min-w-0 flex-1">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// Resultado
// -----------------------------------------------------------------------------

/**
 * EM QUE CAMADA a mudança entrou — dito, não inferido.
 *
 * O agente atua em três níveis somados, e o que muda com o ajuste depende de
 * qual deles recebeu a correção: na base ele vale em toda campanha, inclusive as
 * que estão no ar; na campanha, só ali. O usuário precisa ler isso no resultado
 * sem ter que abrir nada — e sem ser levado a outra tela para descobrir.
 */
export function layerOf(target: string, name: string): { title: string; scope: string } | null {
  switch (target) {
    case 'AGENT':
      return { title: `Base do agente ${name}`, scope: 'vale em todas as campanhas dele' };
    case 'CAMPAIGN':
      return { title: `Campanha ${name}`, scope: 'vale só nesta campanha' };
    case 'PROJECT_PROFILE':
    case 'PROJECT':
      return { title: name ? `Projeto ${name}` : 'Projeto', scope: 'vale para o negócio inteiro' };
    case 'PROJECT_BRAND_IDENTITY':
      return { title: 'Marca do projeto', scope: 'aparência e tom da página pública' };
    case 'PLAYBOOK':
      return { title: `Ofício ${name}`, scope: 'piso de todo agente deste papel' };
    default:
      return null;
  }
}

/** Rota da entidade tocada — o link fica no resultado; ninguém é levado até lá. */
export function entityPath(
  target: string,
  id: string,
  projectId: string | undefined,
): string | null {
  if (target === 'AGENT') return `/agentes/${id}`;
  if (target === 'PROJECT_PROFILE' || target === 'PROJECT') return `/projetos/${id}`;
  if (target === 'CAMPAIGN' && projectId) return `/projetos/${projectId}/campanhas/${id}`;
  if (target === 'PLAYBOOK') return `/admin/playbooks/${id}`;
  return null;
}

function ResultCard({
  entity,
  projectId,
}: {
  entity: NonNullable<TurnViewModel['entity']>;
  projectId: string | undefined;
}) {
  const camada = layerOf(entity.target, entity.name);
  const caminho = entityPath(entity.target, entity.id, projectId);
  const regras =
    entity.target === 'AGENT'
      ? (entity.touched ?? []).filter((regra) => AGENT_FACET_SLUGS[regra.facet as AgentFacet])
      : [];

  if (!camada && !caminho) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-[var(--shadow-card)]">
      {camada && (
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-start gap-2 text-[13px]">
            <Layers aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="font-medium text-text">{camada.title}</span>
              <span className="text-text-subtle"> · {camada.scope}</span>
            </span>
          </p>
          {caminho && (
            <Link
              to={caminho}
              className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-accent hover:underline"
            >
              Abrir
              <ArrowUpRight aria-hidden className="size-3" />
            </Link>
          )}
        </div>
      )}

      {regras.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {regras.map((regra) => (
            <li key={`${regra.facet}-${regra.code}`}>
              <Link
                to={`/agentes/${entity.id}/${AGENT_FACET_SLUGS[regra.facet as AgentFacet]}?regra=${regra.code}`}
                className="group flex items-center gap-2 text-[12px] text-text-muted hover:text-accent"
              >
                <span className="rounded bg-surface-sunken px-1.5 py-px font-mono text-[10px] text-text-subtle group-hover:text-accent">
                  {regra.code}
                </span>
                <span className="min-w-0 truncate">{regra.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {entity.playbook && (
        <Link
          to={`/admin/playbooks/${entity.playbook.key}`}
          className="border-t border-border pt-2 text-[12px] font-medium text-accent hover:underline"
        >
          Ofício "{entity.playbook.label}" também atualizado — v{entity.playbook.versionNumber}
        </Link>
      )}
    </div>
  );
}

const NOTICE_STYLES: Record<HubNotice['tone'], { className: string; icon: typeof Info }> = {
  info: { className: 'text-text-muted', icon: Info },
  warning: { className: 'text-warning', icon: TriangleAlert },
  danger: { className: 'bg-danger-soft text-danger rounded-lg px-3 py-2', icon: TriangleAlert },
};

function Notices({ notices }: { notices: HubNotice[] }) {
  if (notices.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {notices.map((notice) => {
        const style = NOTICE_STYLES[notice.tone];
        return (
          <li
            key={notice.id}
            {...(notice.tone === 'danger' ? { role: 'alert' as const } : {})}
            className={cx('flex items-start gap-2 text-[12px] leading-relaxed', style.className)}
          >
            <style.icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{notice.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Lacunas que o S.O registrou em vez de inventar — clicar vira a próxima fala. */
function Questions({ questions, onPick }: { questions: string[]; onPick: (text: string) => void }) {
  if (questions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-text-muted">
        <HelpCircle aria-hidden className="size-3.5" />
        Para deixar mais preciso
      </p>
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onPick(question)}
          className="rounded-lg border border-border px-3 py-1.5 text-left text-[12px] text-text-muted transition-colors hover:border-accent hover:text-text"
        >
          {question}
        </button>
      ))}
    </div>
  );
}

/** Tokens e custo do turno, com o log do processo atrás de um clique. */
function MetaLine({
  costMicros,
  totalTokens,
  trace,
  status,
}: {
  costMicros: number;
  totalTokens: number;
  trace: HubTraceLine[];
  status: TurnViewModel['status'];
}) {
  const { data: spend } = useSpend();
  const [aberto, setAberto] = useState(false);

  if (totalTokens === 0 && trace.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] text-text-subtle">
        {status === 'completed' && <CircleCheck aria-hidden className="size-3 text-success" />}
        {totalTokens > 0 && (
          <span className="tabular-nums" title={costTitle(costMicros, spend?.rate)}>
            {totalTokens.toLocaleString('pt-BR')} tokens · {formatBrl(costMicros, spend?.rate)}
          </span>
        )}
        {trace.length > 0 && (
          <button
            type="button"
            aria-expanded={aberto}
            onClick={() => setAberto((valor) => !valor)}
            className="inline-flex items-center gap-0.5 hover:text-text"
          >
            processo
            <ChevronDown
              aria-hidden
              className={cx('size-3 transition-transform', aberto && 'rotate-180')}
            />
          </button>
        )}
      </div>
      {aberto && <ProcessLog lines={trace} />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// O turno
// -----------------------------------------------------------------------------

export function TurnView({
  turn,
  projectId,
  onPickQuestion,
  onRetry,
}: {
  turn: TurnViewModel;
  projectId: string | undefined;
  onPickQuestion: (text: string) => void;
  onRetry?: (() => void) | undefined;
}) {
  const trabalhando = turn.status === 'running' && !turn.answer;

  return (
    <article className="flex flex-col gap-3">
      <UserBubble
        text={turn.request}
        {...(turn.attachments ? { attachments: turn.attachments } : {})}
      />

      <div className="flex gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles aria-hidden className="size-3.5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {turn.understood && (
            <p className="flex items-start gap-1.5 text-[12px] text-text-subtle">
              <Compass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{turn.understood}</span>
            </p>
          )}

          {trabalhando && <WorkingLine label={turn.operationLabel} trace={turn.trace} />}

          <Notices notices={turn.notices} />

          {turn.status === 'failed' && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-accent hover:underline"
            >
              <RotateCcw aria-hidden className="size-3" />
              Tentar novamente
            </button>
          )}

          {turn.answer && (
            <RichText text={turn.answer} className="text-[13.5px] leading-relaxed text-text" />
          )}

          {turn.entity && !turn.answering && turn.status !== 'running' && (
            <ResultCard entity={turn.entity} projectId={projectId} />
          )}

          <Questions questions={turn.questions} onPick={onPickQuestion} />

          {turn.status !== 'running' && (
            <MetaLine
              costMicros={turn.costMicros}
              totalTokens={turn.totalTokens}
              trace={turn.trace}
              status={turn.status}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/** Onde cada bloco de conversa aconteceu — o histórico é um só, agrupado. */
export function ContextDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="max-w-[70%] truncate rounded-full border border-border bg-surface px-2.5 py-0.5 text-[10.5px] font-medium text-text-subtle">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
