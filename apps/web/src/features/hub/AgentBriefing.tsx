import { ArrowRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button, cx } from '../../design-system/primitives';
import { useAgentTypes, usePlanBriefing, type BriefingQuestion } from '../agents/agents.api';
import { AGENT_PRESETS } from './agent-presets';

/**
 * As perguntas que precedem a criação do agente.
 *
 * ANTES, não depois. Perguntar depois de criar significa criar sem saber e
 * depois pedir ao modelo que refaça metade da configuração — dois turnos pagos
 * para chegar onde um chegaria. Pior: o usuário lê um agente pronto e assume
 * que aquilo é a resposta final; a pergunta que vem em seguida parece remendo,
 * e ele a ignora.
 *
 * O que se pergunta é FATO DO NEGÓCIO — o que só ele sabe. Ofício (como um
 * comercial conduz uma objeção) o OS deriva; devolver isso ao usuário seria
 * devolver o trabalho que ele veio delegar.
 *
 * A pergunta de INICIATIVA é fixa, em código, e vem primeiro: vale para todo
 * agente, e começar por dois botões tira o peso de encarar um formulário.
 */

export interface BriefingResult {
  /** O briefing pronto para virar a fala de criação. */
  message: string;
  initiator: 'USER' | 'AGENT';
  /**
   * Ofício reconhecido para este papel, quando existe playbook.
   *
   * Vai junto na criação porque a classificação já foi feita e paga aqui —
   * refazê-la depois custaria outro turno e poderia sair diferente.
   */
  playbookKey: string | null;
  /** Em branco = o modelo deriva do negócio. Preenchido = usa exatamente este. */
  name: string | null;
  /** Liga/desliga aplicado por mutação própria — não confia no texto livre. */
  suggestedRepliesEnabled: boolean;
}

export function AgentBriefing({
  onReady,
  onCancel,
  disabled,
}: {
  onReady: (result: BriefingResult) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const plan = usePlanBriefing();
  const { data: types } = useAgentTypes();
  const [role, setRole] = useState('');
  const [questions, setQuestions] = useState<BriefingQuestion[] | null>(null);
  /** O que o OS reconheceu do papel. A tela mostra isso — o usuário merece saber. */
  const [playbook, setPlaybook] = useState<{ key: string; label: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  /**
   * Pergunta pelo papel.
   *
   * Com `key`, o tipo veio de um playbook cadastrado: a classificação já está
   * feita e o servidor devolve as perguntas curadas sem chamar modelo nenhum —
   * instantâneo, de graça, e imune a uma travada do provider.
   */
  function ask(picked: string, key?: string): void {
    setRole(picked);
    plan.mutate(
      { role: picked, ...(key ? { playbookKey: key } : {}) },
      {
        onSuccess: (result) => {
          setQuestions(result.questions);
          setPlaybook(
            result.playbookKey && result.playbookLabel
              ? { key: result.playbookKey, label: result.playbookLabel }
              : null,
          );
        },
      },
    );
  }

  function finish(): void {
    if (!questions) return;

    const initiator = answers['initiator'] === 'AGENT' ? 'AGENT' : 'USER';
    const name = answers['name']?.trim() || null;
    const suggestedRepliesEnabled = answers['suggestedReplies'] === 'YES';
    // Nome e iniciativa são FATO/liga-desliga aplicados por mutação própria
    // depois — nunca texto livre que o modelo poderia parafrasear ou ignorar.
    const excluded = new Set(['initiator', 'name', 'suggestedReplies']);
    // A mensagem PRECISA se afirmar como CRIAÇÃO logo na primeira linha — sem
    // isso, o roteador (que decide pelo TEXTO, não confia cegamente no botão
    // clicado) pode ler "nome: X" como pedido de RENOMEAR um agente já
    // existente, em vez de criar um novo. Medido: aconteceu.
    const lines = [`Crie um novo agente para o papel: ${role.trim()}`];

    for (const question of questions) {
      const answer = answers[question.id]?.trim();
      if (!answer || question.kind === 'CHOICE' || excluded.has(question.id)) continue;
      lines.push(`${question.question} ${answer}`);
    }

    lines.push(
      initiator === 'AGENT'
        ? 'Quem começa a conversa é o AGENTE: ele puxa o assunto sozinho.'
        : 'Quem começa a conversa é a PESSOA: ele responde quando abordado.',
    );

    if (name) lines.push(`Nome deste NOVO agente: ${name}`);

    onReady({
      message: lines.join('\n'),
      initiator,
      playbookKey: playbook?.key ?? null,
      name,
      suggestedRepliesEnabled,
    });
  }

  // --- escolha do papel ---------------------------------------------------
  if (!questions) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[13px] font-medium">Que tipo de agente você quer?</p>
          <p className="mt-1 text-[12px] text-text-subtle">
            Antes de criar, faço algumas perguntas sobre o seu negócio — é o que só você sabe.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {/*
            Os tipos vêm dos PLAYBOOKS cadastrados, não de uma lista em código.
            O que aparece aqui é o que o OS sabe projetar bem — e clicar num
            deles não gasta chamada nenhuma: a classificação já está feita e as
            perguntas daquele ofício estão curadas no banco.
          */}
          {(types ?? []).map((type) => (
            <button
              key={type.key}
              type="button"
              disabled={disabled || plan.isPending}
              onClick={() => ask(type.label, type.key)}
              className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[12px] text-text transition-colors hover:border-accent-hover disabled:opacity-50"
            >
              {type.label}
            </button>
          ))}

          {/*
            Exemplos SEM playbook continuam à mostra: eles ensinam a formular o
            pedido, e escondê-los deixaria a tela vazia numa instalação nova.
            Visualmente discretos, porque prometem menos — aqui o OS deriva o
            ofício sozinho, sem baseline curada por trás.
          */}
          {AGENT_PRESETS.filter(
            (preset) =>
              !(types ?? []).some(
                (type) => type.label.toLowerCase() === preset.label.toLowerCase(),
              ),
          ).map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled || plan.isPending}
              title={preset.hint}
              onClick={() => ask(preset.label)}
              className="rounded-full border border-border px-2.5 py-1 text-[12px] text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (role.trim().length >= 3) ask(role.trim());
          }}
          className="flex items-center gap-2"
        >
          <input
            value={role}
            disabled={disabled || plan.isPending}
            onChange={(event) => setRole(event.target.value)}
            placeholder="ou descreva o papel…"
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] placeholder:text-text-subtle focus:border-border-strong"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={role.trim().length < 3}>
            {plan.isPending ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight aria-hidden className="size-3.5" />
            )}
          </Button>
        </form>

        {plan.isPending && (
          <p className="text-[12px] text-text-subtle">Pensando no que preciso saber…</p>
        )}
        {plan.isError && (
          <p role="alert" className="text-[12px] text-danger">
            Não consegui montar as perguntas. Tente de novo, ou descreva o agente direto no campo
            abaixo.
          </p>
        )}
      </div>
    );
  }

  // --- respostas ----------------------------------------------------------
  const answered = questions.filter((question) => answers[question.id]?.trim()).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[13px] font-medium">{role}</p>
        {playbook ? (
          // O usuário precisa saber em que o OS vai se basear: sem isto ele lê
          // duas perguntas apenas e conclui que o sistema entendeu pouco —
          // quando é o contrário, o ofício já está resolvido.
          <p className="mt-1.5 rounded-[var(--radius-control)] bg-accent-soft px-2.5 py-1.5 text-[12px] leading-relaxed text-text-muted">
            Reconheci o ofício: <span className="font-medium text-text">{playbook.label}</span>. Já
            sei como esse profissional trabalha — só preciso do que é seu.
          </p>
        ) : null}
        <p className="mt-1 text-[12px] text-text-subtle">
          Responda o que souber. O que ficar em branco eu deduzo do papel — e marco como suposição
          minha, para você conferir depois.
        </p>
      </div>

      {questions.map((question) => (
        <div key={question.id}>
          <p className="text-[13px] font-medium">{question.question}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-subtle">{question.why}</p>

          {question.kind === 'CHOICE' ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {question.options?.map((option) => {
                const picked = answers[question.id] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setAnswers((current) => ({ ...current, [question.id]: option.value }))
                    }
                    className={cx(
                      'rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors',
                      picked
                        ? 'border-accent bg-surface-sunken'
                        : 'border-border hover:border-border-strong',
                    )}
                  >
                    <span className="block text-[13px] font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-[11px] text-text-muted">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              rows={2}
              value={answers[question.id] ?? ''}
              placeholder={question.placeholder}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
              }
              className="mt-2 w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] placeholder:text-text-subtle focus:border-border-strong"
            />
          )}
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-text-subtle hover:text-text"
        >
          Cancelar
        </button>
        <Button size="sm" disabled={disabled || !answers['initiator']} onClick={finish}>
          Criar agente
          <ArrowRight aria-hidden className="size-3.5" />
        </Button>
      </div>

      {answered < questions.length && answers['initiator'] && (
        <p className="text-[11px] text-text-subtle">
          {questions.length - answered} sem resposta — dá para seguir assim.
        </p>
      )}
    </div>
  );
}
