import { History } from 'lucide-react';
import { useParams } from 'react-router';
import { Card } from '../../design-system/primitives';
import { usePlaybook } from './admin.api';
import {
  FacetCounts,
  IdentityEditor,
  LimitsEditor,
  PrinciplesEditor,
  QuestionsEditor,
  Section,
  slugKey,
  TextList,
} from './PlaybookEditor';
import { usePlaybookDraftContext } from './PlaybookLayout';

/**
 * Uma página por seção do playbook.
 *
 * Cada uma edita a sua fatia do MESMO rascunho, que vive no layout: o admin
 * passeia entre as seções e salva uma vez. O que é longo aqui — princípios,
 * limites — merecia rota própria de qualquer jeito; num formulário único eles
 * viravam rolagem sem referência de lugar.
 */
export function PlaybookOverviewPage() {
  const { key } = useParams();
  const { draft, set } = usePlaybookDraftContext();
  const { data } = usePlaybook(key);

  return (
    <>
      <IdentityEditor value={draft} onChange={set} lockKey />

      <Card className="p-5">
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-text-subtle">
          <History aria-hidden className="size-3.5" />
          Histórico
        </p>
        <p className="mt-1 text-[12px] text-text-muted">
          Versão é imutável. Editar cria a próxima — nunca reescreve a anterior.
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {(data?.history ?? []).map((version) => (
            <li key={version.versionNumber} className="flex items-start gap-3 text-[13px]">
              <span className="w-8 shrink-0 text-text-subtle tabular-nums">
                v{version.versionNumber}
              </span>
              <div className="min-w-0">
                <p className="text-text-muted">{version.reason}</p>
                <p className="mt-0.5 text-[11px] text-text-subtle">
                  {new Date(version.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export function PlaybookPrinciplesPage() {
  const { draft, set } = usePlaybookDraftContext();

  return (
    <Section
      title="Princípios"
      count={draft.principles.length}
      hint="Cada um vira UM item na configuração do agente, na faceta em que está. A contagem por faceta é literalmente o alvo que a criação de agente vai perseguir."
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
  );
}

export function PlaybookLimitsPage() {
  const { draft, set } = usePlaybookDraftContext();

  return (
    <Section
      title="Nunca"
      count={draft.antiPatterns.length}
      hint="Cada um vira um limite do agente. Escreva o ato, não a virtude: “criar urgência que não existe”, não “ser honesto”."
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
  );
}

export function PlaybookQuestionsPage() {
  const { draft, set } = usePlaybookDraftContext();

  return (
    <>
      <Section
        title="Perguntas do briefing"
        hint="O que o sistema pergunta a quem cria um agente deste papel — e clicar no tipo devolve exatamente estas, sem chamar modelo nenhum. Só entra fato que o usuário sabe e o ofício não responde."
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
        title="Já respondido pelo ofício"
        hint="O que o sistema NÃO deve perguntar a quem cria o agente, porque este playbook já resolve."
        onAdd={() => set({ ...draft, alreadyAnswered: [...draft.alreadyAnswered, ''] })}
      >
        <TextList
          items={draft.alreadyAnswered}
          rows={1}
          placeholder="que tom de voz usar"
          onChange={(next) => set({ ...draft, alreadyAnswered: next })}
        />
      </Section>
    </>
  );
}

export function PlaybookRecognitionPage() {
  const { draft, set } = usePlaybookDraftContext();

  return (
    <Section
      title="Reconhecido por"
      hint="Frases pelas quais o classificador reconhece este papel na fala do usuário. Inclua sinônimos e variações de mercado — é o que faz “consultor de soluções para clínicas” cair aqui."
      onAdd={() => set({ ...draft, appliesTo: [...draft.appliesTo, ''] })}
    >
      <TextList
        items={draft.appliesTo}
        rows={1}
        placeholder="consultor de vendas"
        onChange={(next) => set({ ...draft, appliesTo: next })}
      />
    </Section>
  );
}

export function PlaybookSourcesPage() {
  const { draft, set } = usePlaybookDraftContext();

  return (
    <Section
      title="Fontes"
      hint="De onde vieram as afirmações. Sem isto ninguém consegue auditar uma decisão de ofício meses depois — e ofício é opinião, então a origem importa."
      onAdd={() => set({ ...draft, sources: [...draft.sources, ''] })}
    >
      <TextList
        items={draft.sources}
        rows={1}
        placeholder="Estudo, metodologia ou pesquisa que sustenta os princípios."
        onChange={(next) => set({ ...draft, sources: next })}
      />
    </Section>
  );
}
