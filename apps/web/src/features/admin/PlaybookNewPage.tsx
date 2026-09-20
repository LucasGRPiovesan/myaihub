import { ArrowLeft, FileText, Save, Sparkles, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, cx } from '../../design-system/primitives';
import { useDistillPlaybook, useSavePlaybook, type Playbook } from './admin.api';
import {
  emptyPlaybook,
  FacetCounts,
  IdentityEditor,
  LimitsEditor,
  PrinciplesEditor,
  QuestionsEditor,
  Section,
  slugKey,
  TextList,
} from './PlaybookEditor';

/**
 * Criar um playbook — do zero, ou destilando um estudo.
 *
 * A destilação é o caminho principal e é o que faz esta tela valer: o admin
 * chega com uma pesquisa de dezenas de milhares de tokens, e o que precisa
 * entrar no sistema é a DESTILAÇÃO dela, não o documento. Instrução longa
 * esconde o contrato de saída — o estudo inteiro no prompt de criação quebraria
 * exatamente o que ele deveria melhorar.
 *
 * O modelo propõe; o admin revisa e aprova. Nada é gravado direto: é o mesmo
 * pipeline do resto do produto, com o admin no lugar do usuário.
 */
const FIELD =
  'w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] ' +
  'text-text placeholder:text-text-subtle focus:border-border-strong';

function Distiller({ onReady }: { onReady: (draft: ReturnType<typeof emptyPlaybook>) => void }) {
  const distill = useDistillPlaybook();
  const [document, setDocument] = useState('');
  const [roleHint, setRoleHint] = useState('');
  const [fileName, setFileName] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const ready = document.trim().length >= 200;

  function readFile(picked: File): void {
    setFileName(picked.name);
    // Leitura no cliente: o documento vai no corpo do POST como texto, e não
    // há por que montar upload de arquivo para algo que é lido uma vez.
    void picked.text().then(setDocument);
  }

  return (
    <Card className="p-5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-text-subtle">
        <Sparkles aria-hidden className="size-3.5" />
        Destilar de um estudo
      </p>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-text-muted">
        Cole a pesquisa ou anexe o arquivo. O OS separa o que é OFÍCIO — transferível para qualquer
        empresa daquele papel — do que é arquitetura de um produto específico, e devolve um rascunho
        para você revisar. Nada é salvo antes da sua aprovação.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          value={roleHint}
          onChange={(event) => setRoleHint(event.target.value)}
          placeholder="Papel que este estudo descreve (ex: representante comercial)"
          className={FIELD}
        />
        <div>
          <input
            ref={file}
            type="file"
            accept=".md,.txt,.markdown,text/plain,text/markdown"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) readFile(picked);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => file.current?.click()}
          >
            <Upload aria-hidden className="size-3.5" />
            {fileName || 'Anexar .md'}
          </Button>
        </div>
      </div>

      <textarea
        rows={8}
        value={document}
        onChange={(event) => setDocument(event.target.value)}
        placeholder="…ou cole o conteúdo do estudo aqui."
        className={cx(FIELD, 'mt-3 resize-y font-mono text-[12px]')}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-text-subtle tabular-nums">
          {document.length.toLocaleString('pt-BR')} caracteres
          {distill.isPending && ' · destilando, isto leva um tempo'}
        </p>
        <Button
          size="sm"
          disabled={!ready}
          loading={distill.isPending}
          onClick={() =>
            distill.mutate(
              {
                document: document.trim(),
                ...(roleHint.trim() ? { roleHint: roleHint.trim() } : {}),
              },
              { onSuccess: (result) => onReady(result.playbook) },
            )
          }
        >
          <Sparkles aria-hidden className="size-3.5" />
          Destilar
        </Button>
      </div>

      {distill.isError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {distill.error instanceof Error ? distill.error.message : 'Não foi possível destilar.'}
        </p>
      )}
    </Card>
  );
}

export function PlaybookNewPage() {
  const navigate = useNavigate();
  const save = useSavePlaybook();
  // A criação é um fluxo de uma vez só: rolagem única, sem nível de sidebar.
  // As seções viram rota só depois que o playbook existe.
  const [draft, setDraft] = useState<Playbook>(emptyPlaybook());
  const set = (next: Playbook): void => setDraft(next);
  const [reason, setReason] = useState('Playbook criado.');
  const [started, setStarted] = useState(false);

  const validKey = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(draft.key);
  const ready = validKey && draft.label.trim().length >= 3 && draft.principles.length >= 3;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/admin/playbooks"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Playbooks
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Novo playbook</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-muted">
        Ele vira o piso profissional de todo agente daquele papel, em qualquer conta.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Distiller
          onReady={(playbook) => {
            set(playbook);
            setStarted(true);
            setReason('Destilado de estudo e revisado.');
          }}
        />

        {!started && (
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="flex items-center gap-2 rounded-[var(--radius-card)] border border-border p-4 text-left transition-colors hover:border-border-strong"
          >
            <FileText aria-hidden className="size-4 text-text-subtle" />
            <span className="text-[13px]">
              Ou escreva do zero
              <span className="mt-0.5 block text-[12px] text-text-muted">
                Sem estudo por trás — você preenche cada princípio à mão.
              </span>
            </span>
          </button>
        )}

        {started && (
          <>
            <IdentityEditor value={draft} onChange={set} lockKey={false} />

            <Section
              title="Princípios"
              count={draft.principles.length}
              hint="Cada um vira UM item na configuração do agente, na faceta em que está. A contagem por faceta é o alvo que a criação de agente vai perseguir."
              onAdd={() =>
                set({
                  ...draft,
                  principles: [
                    ...draft.principles,
                    {
                      code: `PR${String(draft.principles.length + 1).padStart(2, '0')}`,
                      semanticKey: slugKey('behavior', `novo ${draft.principles.length + 1}`),
                      label: '',
                      facet: 'behaviors',
                      statement: '',
                    },
                  ],
                })
              }
            >
              <div className="mb-5">
                <FacetCounts items={draft.principles} />
              </div>
              <PrinciplesEditor
                items={draft.principles}
                onChange={(next) => set({ ...draft, principles: next })}
              />
            </Section>

            <Section
              title="Nunca"
              count={draft.antiPatterns.length}
              hint="Cada um vira um limite do agente. Escreva o ato, não a virtude."
              onAdd={() =>
                set({
                  ...draft,
                  antiPatterns: [
                    ...draft.antiPatterns,
                    {
                      code: `LM${String(draft.antiPatterns.length + 1).padStart(2, '0')}`,
                      semanticKey: slugKey('limit', `novo ${draft.antiPatterns.length + 1}`),
                      label: '',
                      statement: '',
                    },
                  ],
                })
              }
            >
              <LimitsEditor
                items={draft.antiPatterns}
                onChange={(next) => set({ ...draft, antiPatterns: next })}
              />
            </Section>

            <Section
              title="Perguntas do briefing"
              hint="O que o sistema pergunta a quem cria um agente deste papel."
              count={draft.worthAsking.length}
              onAdd={() =>
                set({
                  ...draft,
                  worthAsking: [
                    ...draft.worthAsking,
                    {
                      code: `PG${String(draft.worthAsking.length + 1).padStart(2, '0')}`,
                      semanticKey: slugKey('ask', `nova ${draft.worthAsking.length + 1}`),
                      question: '',
                      why: '',
                      placeholder: '',
                    },
                  ],
                })
              }
            >
              <QuestionsEditor
                items={draft.worthAsking}
                onChange={(next) => set({ ...draft, worthAsking: next })}
              />
            </Section>

            <Section
              title="Reconhecido por"
              hint="Frases pelas quais o classificador reconhece este papel na fala do usuário."
              onAdd={() => set({ ...draft, appliesTo: [...draft.appliesTo, ''] })}
            >
              <TextList
                items={draft.appliesTo}
                rows={1}
                placeholder="consultor de vendas"
                onChange={(next) => set({ ...draft, appliesTo: next })}
              />
            </Section>

            <Section
              title="Fontes"
              hint="De onde vieram as afirmações. Ofício é opinião, então a origem importa."
              onAdd={() => set({ ...draft, sources: [...draft.sources, ''] })}
            >
              <TextList
                items={draft.sources}
                rows={1}
                placeholder="Estudo, metodologia ou pesquisa que sustenta os princípios."
                onChange={(next) => set({ ...draft, sources: next })}
              />
            </Section>

            <Card className="p-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Motivo da primeira versão</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className={FIELD}
                />
              </label>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-text-subtle">
                  {validKey
                    ? `${draft.principles.length} princípios · mínimo de 3`
                    : 'A chave precisa ser minúscula, com ponto: sales.consultive'}
                </p>
                <Button
                  size="sm"
                  disabled={!ready}
                  loading={save.isPending}
                  onClick={() =>
                    save.mutate(
                      { key: draft.key, playbook: draft, reason: reason.trim() },
                      { onSuccess: () => navigate(`/admin/playbooks/${draft.key}`) },
                    )
                  }
                >
                  <Save aria-hidden className="size-3.5" />
                  Criar playbook
                </Button>
              </div>

              {save.isError && (
                <p role="alert" className="mt-3 text-[13px] text-danger">
                  {save.error instanceof Error ? save.error.message : 'Não foi possível salvar.'}
                </p>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
