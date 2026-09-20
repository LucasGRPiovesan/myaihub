import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useOutletContext, useParams } from 'react-router';
import { SkeletonText } from '../../design-system/feedback';
import { Button, Card, cx } from '../../design-system/primitives';
import {
  useDistillPlaybook,
  usePlaybook,
  usePlaybookSuggestions,
  useSavePlaybook,
} from './admin.api';
import type { Playbook } from './admin.api';
import { emptyPlaybook, FIELD } from './PlaybookEditor';
import { relativeDate } from './PlaybooksPage';

/**
 * A tela de um playbook, com as seções como ROTAS.
 *
 * Seção longa vira rota, não rolagem: é o mesmo padrão das facetas do agente, e
 * é o que faz a sidebar empilhada dizer onde você está. Um formulário de dois
 * mil pixels não tem "onde você está".
 *
 * O rascunho vive AQUI, no nível acima das seções, para o admin poder passear
 * entre elas e salvar uma vez só. Cada seção salvando sozinha produziria uma
 * versão por clique, e o histórico deixaria de contar uma história.
 */
export interface PlaybookDraft {
  draft: Playbook;
  set: (next: Playbook) => void;
}

export function usePlaybookDraftContext(): PlaybookDraft {
  return useOutletContext<PlaybookDraft>();
}

export function PlaybookLayout() {
  const { key } = useParams();
  const { data, isPending, isError } = usePlaybook(key);
  const save = useSavePlaybook();

  const [draft, setDraft] = useState<Playbook>(emptyPlaybook());
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!data?.playbook) return;
    setDraft(data.playbook);
    setTouched(false);
    // Só quando o playbook carregado MUDA. Incluir o rascunho aqui reiniciaria
    // a edição a cada tecla.
  }, [data?.playbook]);

  if (isPending) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="p-6">
          <SkeletonText lines={6} />
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Não foi possível carregar este playbook.
          </p>
        </Card>
      </div>
    );
  }

  const set = (next: Playbook): void => {
    setDraft(next);
    setTouched(true);
  };

  const ready = touched && reason.trim().length >= 3 && draft.principles.length > 0;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.playbook.label}</h1>
          <p className="mt-1 font-mono text-[12px] text-text-subtle">{data.playbook.key}</p>
        </div>
        <p className="text-[12px] text-text-subtle tabular-nums">
          versão {data.history[0]?.versionNumber ?? 1}
        </p>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-text-muted">
        <Sparkles aria-hidden className="size-3.5" />
        Para calibrar em linguagem natural, fale com o MyAIHub no painel — ele localiza o que muda e
        mexe só nisso. Os campos abaixo são para correção pontual.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {/* As seções vêm por rota; o rascunho desce por contexto. */}
        <Outlet context={{ draft, set } satisfies PlaybookDraft} />

        <CraftPauta playbookKey={data.playbook.key} />

        <Card className="p-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Por que esta versão existe?</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex: reforcei a orientação de parar de insistir depois do não."
              className={FIELD}
            />
            <span className="text-[11px] text-text-subtle">
              Fica no histórico. É o que explica a mudança para quem abrir isto daqui a seis meses.
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={cx('text-[12px]', touched ? 'text-warning' : 'text-text-subtle')}>
              {touched
                ? 'Alterações não salvas. Salvar cria uma versão nova.'
                : 'Nada alterado ainda.'}
            </p>
            <Button
              size="sm"
              disabled={!ready}
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { key: data.playbook.key, playbook: draft, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setReason('');
                      setTouched(false);
                    },
                  },
                )
              }
            >
              <Save aria-hidden className="size-3.5" />
              Salvar versão
            </Button>
          </div>

          {save.isError && (
            <p role="alert" className="mt-3 text-[13px] text-danger">
              {save.error instanceof Error ? save.error.message : 'Não foi possível salvar.'}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * A pauta: correções de OFÍCIO que o OS já aplicou em agentes deste papel.
 *
 * Não é fila de aprovação — cada uma dessas já foi entregue a quem pediu, no
 * agente dele, na hora. O que se decide aqui é outra coisa: se a correção se
 * repete, ela não era daquele agente, era do ofício, e o lugar dela é o
 * playbook. É a evidência que transforma um caso isolado em regra da
 * plataforma, sem que ninguém precise esperar por um admin.
 */
function CraftPauta({ playbookKey }: { playbookKey: string }) {
  const { data, isPending } = usePlaybookSuggestions(playbookKey);

  if (isPending || !data || data.length === 0) return null;

  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium">Correções de ofício vindas do uso</p>
      <p className="mt-1 text-[12px] text-text-muted">
        O OS aplicou isto em agentes deste papel e julgou que valia para qualquer um deles. Já está
        no agente de quem pediu — aqui é para decidir se vira piso.
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {data.map((item) => (
          <li
            key={`${item.createdAt}-${item.summary}`}
            className="rounded-[var(--radius-control)] border border-border bg-surface-muted p-3"
          >
            <p className="flex items-center gap-2 text-[13px]">
              <span className="font-mono text-[11px] text-text-subtle">{item.facet}</span>
              <span className="font-medium">{item.summary}</span>
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[12px] text-text-muted">
              {item.statement}
            </p>
            <p className="mt-1.5 text-[11px] text-text-subtle">{relativeDate(item.createdAt)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Usado só pela tela de criação, que não tem sidebar própria. */
export function BackToPlaybooks() {
  return (
    <a
      href="/admin/playbooks"
      className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      Playbooks
    </a>
  );
}

/** Reexportado para as páginas de seção não precisarem conhecer o layout. */
export { useDistillPlaybook };
