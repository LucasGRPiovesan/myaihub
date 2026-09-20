import type { CanonicalItem } from '@myaihub/shared';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Badge } from '../../design-system/feedback';
import { Button, IconButton, cx } from '../../design-system/primitives';
import { toSemanticKey, useManualMutations, type ManualResource } from './manual.api';

/**
 * Faceta canônica com edição manual (§31).
 *
 * O painel conversacional continua sendo o caminho para INTENÇÃO ("quero que
 * ele seja mais objetivo"). Este é o caminho para CORREÇÃO: trocar uma palavra,
 * apagar um item, digitar um que já está pronto na cabeça. Mandar isso para o
 * modelo custaria tokens e latência para reproduzir o que o usuário acabou de
 * escrever — e às vezes reproduzir errado.
 */

function EnforcementBadge({ item }: { item: CanonicalItem }) {
  if (item.enforcement === 'DETERMINISTIC') {
    return <Badge tone="success">verificada em código</Badge>;
  }
  if (item.enforcement === 'HARD') return <Badge tone="warning">obrigatória</Badge>;
  return null;
}

const INPUT_CLASS =
  'w-full rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-border-strong';

function ItemForm({
  initialLabel,
  initialStatement,
  initialEnforcement,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  initialLabel: string;
  initialStatement: string;
  initialEnforcement: 'SOFT' | 'HARD';
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (label: string, statement: string, enforcement: 'SOFT' | 'HARD') => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [statement, setStatement] = useState(initialStatement);
  const [enforcement, setEnforcement] = useState(initialEnforcement);

  const valid = label.trim().length > 0 && statement.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSubmit(label.trim(), statement.trim(), enforcement);
      }}
    >
      <input
        aria-label="Rótulo"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Rótulo curto"
        maxLength={80}
        className={INPUT_CLASS}
      />
      <textarea
        aria-label="Descrição"
        value={statement}
        onChange={(event) => setStatement(event.target.value)}
        placeholder="O que isto significa, em uma ou duas frases."
        rows={3}
        maxLength={1200}
        className={cx(INPUT_CLASS, 'resize-none')}
      />
      {/*
        A FORÇA precisa ser declarável à mão.

        Ela é a única propriedade do item com consequência de runtime: HARD sobe
        para o bloco de regras inegociáveis do prompt, SOFT fica no meio da lista
        da faceta. Sem este controle, tudo digitado aqui nascia SOFT — e um
        "nunca prometa prazo" escrito à mão chegava ao agente com o peso de
        "prefira ir devagar", sem nada na tela dizendo isso.

        DETERMINISTIC fica de fora de propósito: exige um checker registrado, e
        oferecê-lo aqui prometeria "verificada em código" sem verificação nenhuma.
      */}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Força</legend>
        {(['SOFT', 'HARD'] as const).map((nivel) => (
          <label
            key={nivel}
            className={cx(
              'cursor-pointer rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px]',
              enforcement === nivel
                ? 'border-border-strong bg-surface-sunken text-text'
                : 'border-border text-text-muted',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              checked={enforcement === nivel}
              onChange={() => setEnforcement(nivel)}
            />
            {nivel === 'SOFT' ? 'orientação' : 'obrigatória'}
          </label>
        ))}
        <span className="text-[11px] text-text-subtle">
          {enforcement === 'HARD'
            ? 'Entra nas regras inegociáveis do prompt.'
            : 'O agente pondera junto com o resto.'}
        </span>
      </fieldset>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!valid} loading={busy}>
          <Check aria-hidden className="size-3.5" />
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export interface EditableFacetProps {
  label: string;
  items: CanonicalItem[];
  resource: ManualResource;
  entityId: string;
  /** Mutação de upsert desta faceta, vinda do contrato compartilhado. */
  upsertKind: string;
  removeKind: string;
  /** Nome da faceta no documento canônico — o `REMOVE` precisa dele. */
  facet: string;
  semanticPrefix: string;
}

/**
 * A regra que o painel mandou destacar, lida da URL.
 *
 * Query param e não estado compartilhado: assim o link funciona colado, aberto
 * em outra aba e no botão de voltar — que é o que se espera de um link.
 */
function useRegraDestacada(codigos: readonly string[]): string | null {
  const [params, setParams] = useSearchParams();
  const alvo = params.get('regra');
  const existe = alvo !== null && codigos.includes(alvo);
  const [destacado, setDestacado] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo || !existe) return;

    setDestacado(alvo);
    document.getElementById(`regra-${alvo}`)?.scrollIntoView({ block: 'center' });

    // O param sai da URL depois de usado: recarregar a página não deveria
    // piscar de novo uma regra que o usuário já viu. Na forma funcional para
    // não depender de `params` — a própria limpeza reexecutaria o efeito.
    setParams(
      (anterior) => {
        const limpo = new URLSearchParams(anterior);
        limpo.delete('regra');
        return limpo;
      },
      { replace: true },
    );

    const fim = setTimeout(() => setDestacado(null), 1800);
    return () => clearTimeout(fim);
  }, [alvo, existe, setParams]);

  return destacado;
}

export function EditableFacet({
  label,
  items,
  resource,
  entityId,
  upsertKind,
  removeKind,
  facet,
  semanticPrefix,
}: EditableFacetProps) {
  const mutate = useManualMutations(resource, entityId);
  const [editing, setEditing] = useState<string | null>(null);
  const destacado = useRegraDestacada(items.map((item) => item.code));
  const [adding, setAdding] = useState(false);

  function upsert(
    semanticKey: string,
    itemLabel: string,
    statement: string,
    enforcement: 'SOFT' | 'HARD',
  ): void {
    mutate.mutate(
      {
        mutations: [{ kind: upsertKind, semanticKey, label: itemLabel, statement, enforcement }],
        reason: `Edição manual em ${label.toLowerCase()}`,
      },
      {
        onSuccess: () => {
          setEditing(null);
          setAdding(false);
        },
      },
    );
  }

  function remove(item: CanonicalItem): void {
    mutate.mutate({
      mutations: [
        { kind: removeKind, facet, itemId: item.id, reason: 'Removido manualmente pelo usuário.' },
      ],
      reason: `Remoção manual em ${label.toLowerCase()}`,
    });
  }

  if (items.length === 0 && !adding) {
    return (
      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
            {label}
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-3.5" />
            Adicionar
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
          {label}
        </h2>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-3.5" />
            Adicionar
          </Button>
        )}
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            // O link do painel aponta para o CÓDIGO: é o que o OS cita na
            // resposta ("ajustei a ST01") e o que o usuário vê na lista.
            id={`regra-${item.code}`}
            className={cx(
              'rounded-[var(--radius-control)] border border-border px-3 py-2.5',
              destacado === item.code && 'flash-regra',
            )}
          >
            {editing === item.id ? (
              <ItemForm
                initialLabel={item.label}
                initialStatement={item.statement}
                // DETERMINISTIC não é editável aqui, mas também não pode ser
                // silenciosamente rebaixado para SOFT ao salvar um ajuste de
                // texto: o mais próximo que este formulário oferece é 'obrigatória'.
                initialEnforcement={item.enforcement === 'SOFT' ? 'SOFT' : 'HARD'}
                submitLabel="Salvar"
                busy={mutate.isPending}
                onCancel={() => setEditing(null)}
                // Mesma `semanticKey`: é o item existente sendo refinado, não um
                // item novo dizendo a mesma coisa (§5.1).
                onSubmit={(newLabel, statement, enforcement) =>
                  upsert(item.semanticKey, newLabel, statement, enforcement)
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-text-subtle">{item.code}</span>
                  <span className="text-sm font-medium">{item.label}</span>
                  <EnforcementBadge item={item} />
                  {item.source === 'USER' && <Badge tone="accent">definido por você</Badge>}
                  {item.source === 'MYAIHUB_BASELINE' && (
                    // O usuário precisa distinguir o que ELE pediu do que o OS
                    // inferiu do papel — senão não sabe o que pode ajustar sem
                    // medo, nem por que aquilo está ali.
                    <Badge>base do MyAIHub</Badge>
                  )}
                  <span className="ml-auto flex items-center gap-0.5">
                    <IconButton label={`Editar ${item.label}`} onClick={() => setEditing(item.id)}>
                      <Pencil aria-hidden className="size-3.5" />
                    </IconButton>
                    <IconButton label={`Remover ${item.label}`} onClick={() => remove(item)}>
                      <Trash2 aria-hidden className="size-3.5" />
                    </IconButton>
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.statement}</p>
                {item.rationale && (
                  <p className="mt-1 text-[11px] text-text-subtle">{item.rationale}</p>
                )}
              </>
            )}
          </li>
        ))}

        {adding && (
          <li className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-2.5">
            <ItemForm
              initialLabel=""
              initialStatement=""
              initialEnforcement="SOFT"
              submitLabel="Adicionar"
              busy={mutate.isPending}
              onCancel={() => setAdding(false)}
              onSubmit={(newLabel, statement, enforcement) =>
                upsert(toSemanticKey(semanticPrefix, newLabel), newLabel, statement, enforcement)
              }
            />
          </li>
        )}
      </ul>

      {mutate.isError && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-[13px] text-danger">
          <X aria-hidden className="size-3.5" />
          {mutate.error instanceof Error ? mutate.error.message : 'Não foi possível salvar.'}
        </p>
      )}
    </section>
  );
}
