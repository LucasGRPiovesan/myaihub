import type {
  PlaybookFacet,
  PlaybookLimit,
  PlaybookPrinciple,
  PlaybookQuestion,
} from '@myaihub/shared';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '../../design-system/feedback';
import { Button, Card, cx } from '../../design-system/primitives';
import type { Playbook } from './admin.api';

/**
 * Campos do playbook, por seção.
 *
 * O editor é a metade da CORREÇÃO — trocar uma palavra, apagar um item. A
 * metade da INTENÇÃO é o OS, pelo painel: "ele insiste demais depois do não" é
 * pedido de engenharia, não de digitação.
 *
 * Cada item mostra o CÓDIGO (PR03, LM01) porque é por ele que o admin fala do
 * item com o OS — "reforça o PR11" é mais preciso que descrever o princípio de
 * novo, e a chave semântica ao lado é o que garante que refinar não duplique.
 */
export const FACETS: Array<{ value: PlaybookFacet; label: string; hint: string }> = [
  { value: 'personality', label: 'Personalidade', hint: 'como o agente É' },
  { value: 'communication', label: 'Comunicação', hint: 'como ele SE COMUNICA' },
  { value: 'skills', label: 'Skills', hint: 'o que ele SABE FAZER' },
  { value: 'behaviors', label: 'Comportamentos', hint: 'como ele AGE' },
  { value: 'strategies', label: 'Estratégias', hint: 'abordagens disponíveis' },
  { value: 'hardRules', label: 'Regras duras', hint: 'obrigações inegociáveis' },
];

const FACET_LABEL = new Map(FACETS.map((facet) => [facet.value, facet.label]));

/**
 * Base SEM largura.
 *
 * `w-full` e `w-40` na mesma classe é conflito de Tailwind: mesma
 * especificidade, e quem vence é a ordem da FOLHA, não a da string. Foi o que
 * espremeu a caixa de texto do princípio até uma letra por linha.
 */
const FIELD_BASE =
  'rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] ' +
  'text-text placeholder:text-text-subtle focus:border-border-strong';

export const FIELD = cx(FIELD_BASE, 'w-full');

export function Section({
  title,
  hint,
  children,
  onAdd,
  count,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  onAdd?: () => void;
  count?: number;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[12.5px] font-semibold tracking-tight text-text-subtle">
            {title}
            {count !== undefined && (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] tabular-nums">
                {count}
              </span>
            )}
          </p>
          <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-text-muted">{hint}</p>
        </div>
        {onAdd && (
          <Button size="sm" variant="secondary" onClick={onAdd} type="button">
            <Plus aria-hidden className="size-3.5" />
            Adicionar
          </Button>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function ItemHeader({ code, semanticKey }: { code: string; semanticKey: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
        {code}
      </span>
      <span className="truncate font-mono text-[11px] text-text-subtle">{semanticKey}</span>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded p-1.5 text-text-subtle hover:bg-surface-sunken hover:text-danger"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  );
}

/** Lista de textos puros — reconhecimento, já respondido, fontes. */
export function TextList({
  items,
  placeholder,
  rows = 2,
  onChange,
}: {
  items: string[];
  placeholder: string;
  rows?: number;
  onChange: (next: string[]) => void;
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-text-subtle">Nada aqui ainda.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => (
        // O índice é chave legítima: a lista é editada em bloco e não tem
        // identidade própria por item.
        <li key={index} className="flex items-start gap-2">
          <textarea
            rows={rows}
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
            className={cx(FIELD_BASE, 'min-w-0 flex-1 resize-y')}
          />
          <RemoveButton
            label="Remover"
            onClick={() => onChange(items.filter((_, position) => position !== index))}
          />
        </li>
      ))}
    </ul>
  );
}

export function FacetCounts({ items }: { items: PlaybookPrinciple[] }) {
  return (
    // O alvo que a criação de agente vai perseguir, visível enquanto se escreve.
    <div className="flex flex-wrap gap-1.5">
      {FACETS.map((facet) => {
        const count = items.filter((item) => item.facet === facet.value).length;
        return (
          <span
            key={facet.value}
            title={facet.hint}
            className={cx(
              'rounded-full px-2.5 py-1 text-[11px] tabular-nums',
              count > 0 ? 'bg-accent-soft text-text' : 'border border-border text-text-subtle',
            )}
          >
            {facet.label} {count}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Princípios AGRUPADOS POR FACETA.
 *
 * A faceta não é um atributo do item: é onde ele nasce dentro do agente, e o
 * número por faceta é o alvo que a criação persegue. Numa lista corrida com um
 * seletor por linha isso ficava invisível — o admin via quinze caixas de texto
 * e nenhuma estrutura.
 */
export function PrinciplesEditor({
  items,
  onChange,
}: {
  items: PlaybookPrinciple[];
  onChange: (next: PlaybookPrinciple[]) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-text-subtle">
        Nenhum princípio. Sem eles o playbook não muda nada no agente.
      </p>
    );
  }

  const update = (semanticKey: string, patch: Partial<PlaybookPrinciple>): void =>
    onChange(
      items.map((item) => (item.semanticKey === semanticKey ? { ...item, ...patch } : item)),
    );

  return (
    <div className="flex flex-col gap-5">
      {FACETS.map((facet) => {
        const group = items.filter((item) => item.facet === facet.value);
        if (group.length === 0) return null;

        return (
          <section key={facet.value}>
            <p className="text-[12px] font-medium">
              {facet.label}
              <span className="ml-2 font-normal text-text-subtle">{facet.hint}</span>
            </p>

            <ul className="mt-2 flex flex-col gap-2">
              {group.map((item) => (
                <li
                  key={item.semanticKey}
                  className="rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <ItemHeader code={item.code} semanticKey={item.semanticKey} />
                    <RemoveButton
                      label={`Remover ${item.code}`}
                      onClick={() =>
                        onChange(items.filter((other) => other.semanticKey !== item.semanticKey))
                      }
                    />
                  </div>

                  <input
                    value={item.label}
                    placeholder="Nome curto do princípio"
                    onChange={(event) => update(item.semanticKey, { label: event.target.value })}
                    className={cx(FIELD, 'mt-2 font-medium')}
                  />

                  <textarea
                    rows={3}
                    value={item.statement}
                    placeholder="A instrução que o agente recebe. Terceira pessoa, acionável — não um rótulo."
                    onChange={(event) =>
                      update(item.semanticKey, { statement: event.target.value })
                    }
                    className={cx(FIELD, 'mt-2 resize-y')}
                  />

                  <label className="mt-2 flex items-center gap-2 text-[11px] text-text-subtle">
                    Faceta
                    <select
                      value={item.facet}
                      onChange={(event) =>
                        update(item.semanticKey, { facet: event.target.value as PlaybookFacet })
                      }
                      className={cx(FIELD_BASE, 'w-44 py-1 text-[12px]')}
                    >
                      {FACETS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {FACET_LABEL.get(option.value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function LimitsEditor({
  items,
  onChange,
}: {
  items: PlaybookLimit[];
  onChange: (next: PlaybookLimit[]) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-text-subtle">
        Nenhum limite. O agente nasce sem as proteções que o ofício exige.
      </p>
    );
  }

  const update = (semanticKey: string, patch: Partial<PlaybookLimit>): void =>
    onChange(
      items.map((item) => (item.semanticKey === semanticKey ? { ...item, ...patch } : item)),
    );

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.semanticKey}
          className="rounded-[var(--radius-control)] border border-border p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <ItemHeader code={item.code} semanticKey={item.semanticKey} />
            <RemoveButton
              label={`Remover ${item.code}`}
              onClick={() =>
                onChange(items.filter((other) => other.semanticKey !== item.semanticKey))
              }
            />
          </div>

          <input
            value={item.label}
            placeholder="Nome curto do limite"
            onChange={(event) => update(item.semanticKey, { label: event.target.value })}
            className={cx(FIELD, 'mt-2 font-medium')}
          />

          <textarea
            rows={2}
            value={item.statement}
            placeholder="O ato proibido. Escreva o ato, não a virtude."
            onChange={(event) => update(item.semanticKey, { statement: event.target.value })}
            className={cx(FIELD, 'mt-2 resize-y')}
          />
        </li>
      ))}
    </ul>
  );
}

export function QuestionsEditor({
  items,
  onChange,
}: {
  items: PlaybookQuestion[];
  onChange: (next: PlaybookQuestion[]) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-text-subtle">
        Sem perguntas próprias — o briefing vai pedir ao modelo que invente as dele, e aí a resposta
        muda a cada criação.
      </p>
    );
  }

  const update = (semanticKey: string, patch: Partial<PlaybookQuestion>): void =>
    onChange(
      items.map((item) => (item.semanticKey === semanticKey ? { ...item, ...patch } : item)),
    );

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.semanticKey}
          className="rounded-[var(--radius-control)] border border-border p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <ItemHeader code={item.code} semanticKey={item.semanticKey} />
            <RemoveButton
              label={`Remover ${item.code}`}
              onClick={() =>
                onChange(items.filter((other) => other.semanticKey !== item.semanticKey))
              }
            />
          </div>

          <input
            value={item.question}
            placeholder="A pergunta, em linguagem de negócio."
            onChange={(event) => update(item.semanticKey, { question: event.target.value })}
            className={cx(FIELD, 'mt-2 font-medium')}
          />
          <input
            value={item.why}
            placeholder="O que muda no agente conforme a resposta."
            onChange={(event) => update(item.semanticKey, { why: event.target.value })}
            className={cx(FIELD, 'mt-2')}
          />
          <input
            value={item.placeholder}
            placeholder="Exemplo de resposta (opcional)."
            onChange={(event) => update(item.semanticKey, { placeholder: event.target.value })}
            className={cx(FIELD, 'mt-2 text-text-muted')}
          />
        </li>
      ))}
    </ul>
  );
}

export function IdentityEditor({
  value,
  onChange,
  lockKey,
}: {
  value: Playbook;
  onChange: (next: Playbook) => void;
  /** A chave é identidade: num playbook que já existe, ela não muda. */
  lockKey: boolean;
}) {
  const set = <K extends keyof Playbook>(field: K, next: Playbook[K]): void =>
    onChange({ ...value, [field]: next });

  return (
    <Card className="p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Nome</span>
          <input
            value={value.label}
            onChange={(event) => set('label', event.target.value)}
            placeholder="Representante comercial consultivo"
            className={FIELD}
          />
          <span className="text-[11px] text-text-subtle">
            É este nome que aparece como tipo de agente no painel do usuário.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Chave</span>
          <input
            value={value.key}
            disabled={lockKey}
            onChange={(event) => set('key', event.target.value)}
            placeholder="sales.consultive"
            className={cx(FIELD, 'font-mono disabled:opacity-60')}
          />
          <span className="text-[11px] text-text-subtle">
            {lockKey
              ? 'A chave é identidade: ela não muda depois de criada.'
              : 'Minúsculas e ponto. É por ela que o playbook é referenciado.'}
          </span>
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Tese</span>
        <textarea
          rows={4}
          value={value.thesis}
          onChange={(event) => set('thesis', event.target.value)}
          placeholder="O que separa quem é excelente neste papel de quem é apenas correto."
          className={cx(FIELD, 'resize-y')}
        />
        <span className="text-[11px] text-text-subtle">
          É a primeira coisa que o modelo lê. Uma frase que orienta todo o resto.
        </span>
      </label>

      {value.key.startsWith('core.') && (
        <p className="mt-4 rounded-[var(--radius-control)] bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-text-muted">
          <Badge tone="accent">piso</Badge> Este playbook vale para <strong>todo</strong> agente, de
          qualquer papel, e é somado ao playbook de ofício. Ele não aparece para o classificador —
          não é uma opção, é o mínimo de todas.
        </p>
      )}
    </Card>
  );
}

/** Chave semântica a partir do texto, para item criado à mão. */
export function slugKey(prefix: string, text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  // Sem texto ainda: uma chave provisória e única, que o admin troca ao salvar.
  return `${prefix}.${slug || `item_${Date.now().toString(36)}`}`;
}

/** Um playbook vazio, para a tela de criação. */
export function emptyPlaybook(): Playbook {
  return {
    key: '',
    label: '',
    appliesTo: [],
    thesis: '',
    principles: [],
    antiPatterns: [],
    alreadyAnswered: [],
    worthAsking: [],
    sources: [],
  };
}
