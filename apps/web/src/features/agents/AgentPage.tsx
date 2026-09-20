import {
  AGENT_FACET_CODES,
  AGENT_FACET_LABELS,
  AGENT_FACET_SLUGS,
  type AgentFacet,
  type CanonicalAgent,
} from '@myaihub/shared';
import { Check, Pencil, Sparkles, Trash2, X as XIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Button, Card, cx } from '../../design-system/primitives';
import { useAgentCampaigns } from '../campaigns/campaigns.api';
import { useManualMutations } from '../canonical/manual.api';
import { useHub } from '../hub/HubProvider';
import { AgentHealthCard } from './AgentHealthCard';
import { AgentLab } from './AgentLab';
import { CalibrationVeil } from '../hub/CalibrationVeil';
import {
  useAgent,
  useAgentVersions,
  useDeleteAgent,
  useDeletionBlockers,
  useSyncCraft,
  type AgentDetail,
  type AgentVersion,
} from './agents.api';

const FACET_ORDER = Object.keys(AGENT_FACET_CODES) as AgentFacet[];

/**
 * Nome editável — `SET_AGENT_IDENTITY` já existia no backend, sem UI nenhuma
 * usando. É a mesma porta manual do resto da configuração (§31: correção que
 * o usuário já decidiu não precisa passar por modelo).
 */
function AgentNameField({ agentId, name }: { agentId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const rename = useManualMutations('agents', agentId);

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          aria-label="Renomear agente"
          className="text-text-subtle hover:text-text"
        >
          <Pencil aria-hidden className="size-3.5" />
        </button>
      </div>
    );
  }

  function save(): void {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    rename.mutate(
      {
        mutations: [{ kind: 'SET_AGENT_IDENTITY', name: trimmed }],
        reason: 'Renomeado pela tela do agente',
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        disabled={rename.isPending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') setEditing(false);
        }}
        className="rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1 text-2xl font-semibold tracking-tight"
      />
      <button
        type="button"
        onClick={save}
        disabled={rename.isPending}
        aria-label="Salvar nome"
        className="text-success hover:opacity-80"
      >
        <Check aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label="Cancelar"
        className="text-text-subtle hover:text-text"
      >
        <XIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/**
 * Onde este agente está atuando.
 *
 * O vínculo é uma coluna, então a pergunta tem resposta barata — e ela importa:
 * antes de mexer no Agent Core, o usuário precisa saber quantas campanhas vão
 * sentir a mudança. Publicações já no ar não mudam, mas as próximas mudam.
 */
function ActiveCampaigns({ agentId }: { agentId: string }) {
  const { data: campaigns } = useAgentCampaigns(agentId);

  if (!campaigns || campaigns.length === 0) return null;

  return (
    <Card className="p-4">
      <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
        Atuando em
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <Link
              to={`/projetos/${campaign.projectId}/campanhas/${campaign.id}`}
              className="flex items-center gap-2 text-sm text-text-muted hover:text-text"
            >
              <span className="min-w-0 flex-1 truncate">{campaign.name}</span>
              {campaign.status === 'PUBLISHED' && <Badge tone="success">no ar</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Excluir agente, com a consistência dos vínculos à vista.
 *
 * O bloqueio é consultado ANTES de oferecer o botão: descobrir que não dá
 * depois de confirmar é a pior hora de descobrir. E os dois bloqueios são
 * diferentes — vínculo se resolve desvinculando, publicação exige despublicar.
 */
function DeleteAgent({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { data: blockers } = useDeletionBlockers(agentId);
  const remove = useDeleteAgent(agentId);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const blocked = (blockers?.length ?? 0) > 0;

  if (blocked) {
    return (
      <Card className="p-4">
        <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
          Excluir agente
        </p>
        <p className="mt-1.5 text-sm text-text-muted">
          Não dá enquanto ele estiver em uso. Ele está em:
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {blockers?.map((blocker) => (
            <li key={blocker.campaignId} className="flex items-center gap-2 text-sm">
              <Link
                to={`/projetos/${blocker.projectId}/campanhas/${blocker.campaignId}`}
                className="text-accent hover:underline"
              >
                {blocker.campaignName}
              </Link>
              {blocker.kind === 'DEPLOYMENT' ? (
                <Badge tone="warning">no ar — despublique primeiro</Badge>
              ) : (
                <Badge>vinculado — desvincule primeiro</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
            Excluir agente
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Apaga o agente e todo o histórico de versões. Não dá para desfazer.
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, { onSuccess: () => void navigate('/agentes') })
              }
            >
              Excluir {agentName}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden className="size-4" />
            Excluir
          </Button>
        )}
      </div>

      {remove.isError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {remove.error instanceof Error ? remove.error.message : 'Não foi possível excluir.'}
        </p>
      )}
    </Card>
  );
}

/**
 * Visão Geral do agente: a CAPA, não um formulário.
 *
 * As sete facetas viraram rotas próprias, e o que sobrou aqui é o que se quer
 * saber de relance — quem ele é, se está pronto para o ar, onde está atuando —
 * mais a única coisa que não se faz em outro lugar: FALAR com ele.
 *
 * Por isso o Lab é o protagonista e ocupa a coluna larga. Configurar sem testar
 * é escrever no escuro, e um chat espremido entre cartões vira decoração que
 * ninguém usa.
 */
export function AgentPage() {
  const { agentId } = useParams();
  const { data: agent, isPending, isError } = useAgent(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const { open, working, state: hubState } = useHub();

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Agente não encontrado.
          </p>
        </Card>
      </div>
    );
  }

  const config = agent.configuration?.canonical;
  // O S.O está trabalhando NESTE agente — e não em outro escopo qualquer.
  const calibrando = working?.scope === 'AGENT' && working.scopeId === agent.id;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <AgentNameField agentId={agent.id} name={agent.name} />
          <p className="mt-1 text-sm text-text-muted">{agent.role}</p>
          {config?.objective.primary && (
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-muted">
              {config.objective.primary}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-text-subtle">
            {agent.configuration && <span>versão {agent.configuration.versionNumber}</span>}
            {config && (
              <Badge>
                {config.engagement.initiator === 'AGENT'
                  ? 'ele puxa o assunto'
                  : 'responde quando abordado'}
              </Badge>
            )}
            {config?.engagement.initiator === 'AGENT' &&
              config.engagement.openerMode === 'SCRIPTED' && (
                // Abertura por roteiro é a exceção, e uma exceção invisível é a
                // que produz a queixa "por que ele fala sempre a mesma coisa?".
                <Badge tone="warning">saudação fixa</Badge>
              )}
            {config?.engagement.suggestedRepliesEnabled && (
              // Mesmo padrão de initiator/openerMode: somente leitura aqui,
              // editável só pelo chat com o S.O ("Ajustar").
              <Badge tone="accent">respostas recomendadas</Badge>
            )}
            {config?.engagement.visualBlocksEnabled && (
              <Badge tone="accent">apresenta com componentes</Badge>
            )}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={open}>
          <Sparkles aria-hidden className="size-4" />
          Ajustar
        </Button>
      </header>

      {/*
        O S.O ESTÁ MEXENDO NESTE AGENTE: a tela fecha até ele terminar.
        Conversar com uma configuração que está sendo reescrita produz resposta
        que já não corresponde a nada — e cada turno desses é token gasto para
        gerar confusão. O painel continua ao lado, com o log do que está
        acontecendo.
      */}
      <div className="relative mt-5 flex min-h-0 flex-1 flex-col">
        {calibrando && (
          <div className="absolute inset-0 z-20 flex">
            <CalibrationVeil
              status={hubState.trace.at(-1)?.text ?? 'Interpretando o pedido…'}
              steps={working?.steps ?? 0}
            />
          </div>
        )}

        {/*
          O conteúdo continua MONTADO por baixo, só inalcançável.
          Desmontá-lo perderia a conversa de teste — e é justamente ela que o
          S.O está lendo para se corrigir, e que precisa reiniciar quando ele
          terminar. Some da mão e do leitor de tela; permanece na memória.
        */}
        <div
          {...(calibrando ? { 'aria-hidden': true } : {})}
          className={cx(
            'grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]',
            calibrando && 'pointer-events-none select-none opacity-0',
          )}
        >
          {agent.configuration ? (
            <AgentLab
              agentId={agent.id}
              fill
              autoOpen={config?.engagement.initiator === 'AGENT'}
              configVersion={agent.configuration.versionNumber}
            />
          ) : (
            <Card className="flex items-center p-6">
              <p className="text-sm leading-relaxed text-text-muted">
                Este agente ainda não tem configuração salva. Descreva no MyAIHub o que ele faz — e
                então dá para conversar com ele aqui.
              </p>
            </Card>
          )}

          <aside className="flex min-w-0 flex-col gap-4 overflow-auto">
            {config && <AgentHealthCard agent={config} />}
            <CraftUpdate agentId={agent.id} craft={agent.craft} />
            <ConfigurationMap agentId={agent.id} config={config} />
            <ActiveCampaigns agentId={agent.id} />
            <History versions={versions ?? []} />
            <DeleteAgent agentId={agent.id} agentName={agent.name} />
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * O piso profissional deste papel evoluiu depois que o agente foi projetado.
 *
 * O agente NÃO muda sozinho. Playbook é da plataforma e agente é do usuário:
 * reescrever um pelo outro faria o comportamento em produção virar do avesso
 * porque um admin editou um documento noutra tela — e o usuário descobriria
 * pelo cliente dele. Então a evolução vira OFERTA.
 *
 * Aceitar roda o caminho normal de ajuste: o ofício atual já entra no contexto
 * de toda operação de agente, o `guardAgainstRegression` protege o que existe,
 * e a versão nova fica no histórico com rollback. Consistência sem regressão.
 *
 * O aviso some sozinho depois de qualquer ajuste — a versão vista é carimbada
 * a cada operação, porque o ofício vigente esteve no contexto daquela rodada.
 *
 * `seenVersion === 0` é agente anterior a este carimbo: sem saber o que ele
 * viu, avisar seria adivinhar, e um aviso que não dá para confiar é ruído.
 */
function CraftUpdate({ agentId, craft }: { agentId: string; craft: AgentDetail['craft'] }) {
  const sincronizar = useSyncCraft(agentId);
  if (!craft || craft.seenVersion === 0 || craft.seenVersion >= craft.currentVersion) return null;

  return (
    <Card className="p-4">
      <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
        Ofício atualizado
      </p>
      <p className="mt-2 text-[13px] leading-relaxed">
        O playbook <span className="font-medium">{craft.label}</span> evoluiu da v
        {craft.seenVersion} para a v{craft.currentVersion} depois que este agente foi projetado.
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">
        Ele continua funcionando como está. Atualizar aplica o que passou a fazer parte do piso do
        papel — sem apagar nada do que já foi calibrado aqui.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3"
        loading={sincronizar.isPending}
        onClick={() => sincronizar.mutate()}
      >
        <Sparkles aria-hidden className="size-3.5" />
        Atualizar pelo ofício
      </Button>

      {sincronizar.isError && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {sincronizar.error instanceof Error
            ? sincronizar.error.message
            : 'Não foi possível atualizar.'}
        </p>
      )}
    </Card>
  );
}

/** O mapa das facetas: quantos itens e o caminho, sem o conteúdo. */
function ConfigurationMap({
  agentId,
  config,
}: {
  agentId: string;
  config: CanonicalAgent | undefined;
}) {
  if (!config) return null;

  return (
    <Card className="p-4">
      <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
        Configuração
      </p>
      <ul className="mt-2.5 flex flex-col gap-1">
        {FACET_ORDER.map((facet) => (
          <li key={facet}>
            <Link
              to={`/agentes/${agentId}/${AGENT_FACET_SLUGS[facet]}`}
              className="flex items-baseline gap-2 text-[13px] text-text-muted hover:text-text"
            >
              <span
                className={cx(
                  'w-4 shrink-0 text-right font-medium tabular-nums',
                  config[facet].length === 0 ? 'text-text-subtle' : 'text-text',
                )}
              >
                {config[facet].length}
              </span>
              <span className="truncate">{AGENT_FACET_LABELS[facet]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function History({ versions }: { versions: AgentVersion[] }) {
  if (versions.length === 0) return null;

  return (
    <Card className="p-4">
      <p className="text-[12.5px] font-semibold tracking-tight text-text-subtle">
        Histórico
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {versions.slice(0, 6).map((version) => (
          <li key={version.id} className="flex items-baseline gap-2 text-[12px]">
            <span className="shrink-0 font-mono text-[11px] text-text-subtle">
              v{version.versionNumber}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-muted">{version.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
