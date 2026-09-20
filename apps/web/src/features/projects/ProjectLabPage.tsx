import { FlaskConical } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SkeletonText } from '../../design-system/feedback';
import { Card } from '../../design-system/primitives';
import { AgentLab } from '../agents/AgentLab';
import { useAgent, useAgents } from '../agents/agents.api';
import { useProjectCampaigns } from '../campaigns/campaigns.api';
import { useProject } from './projects.api';

/**
 * O Lab com o contexto do PROJETO INTEIRO (§17 Fase 8).
 *
 * É o mesmo Lab das outras duas telas, e de propósito — três laboratórios
 * seriam três comportamentos para a mesma pergunta. O que muda é o RECORTE do
 * contexto, e é ele que decide o que o teste mede:
 *
 *   direto no agente   nenhum negócio em volta; o usuário escreve um cenário
 *   pelo projeto       o negócio inteiro: ofertas, públicos, regras
 *   pela campanha      o negócio MAIS o objetivo e o público daquela ação
 *
 * Este do meio é o que faltava, e é o que responde à pergunta que o usuário faz
 * depois de cadastrar o negócio: "ele aprendeu isso?". Pela campanha o recorte
 * é estreito demais para essa conferência; direto no agente o projeto nem entra.
 *
 * Quem conversa é escolhido na tela, com os agentes das campanhas do projeto na
 * frente: são eles que efetivamente falam por este negócio.
 */
export function ProjectLabPage() {
  const { projectId } = useParams();
  const { data: project, isPending } = useProject(projectId);
  const { data: campaigns } = useProjectCampaigns(projectId);
  const { data: agents } = useAgents();

  /** Os agentes que já atuam neste projeto, sem repetir quem serve duas campanhas. */
  const doProjeto = useMemo(() => {
    const ids = new Set((campaigns ?? []).map((campaign) => campaign.agentId).filter(Boolean));
    return (agents ?? []).filter((agent) => ids.has(agent.id));
  }, [campaigns, agents]);

  /*
    Os do projeto primeiro; os demais continuam à mão porque testar um agente
    AINDA não vinculado contra este negócio é exatamente como se decide vinculá-lo.

    E o padrão sai DAQUI, não de `doProjeto`. Vindo de lá, uma conta com agente
    e sem campanha caía no estado vazio — que afirma "esta conta ainda não tem
    agente" com o agente pronto do outro lado da sidebar. O seletor só aparece
    com mais de uma opção, então não havia nem como escolhê-lo: a tela dizia que
    ele não existia e não oferecia caminho nenhum até ele.
  */
  const opcoes = useMemo(
    () => [...doProjeto, ...(agents ?? []).filter((agent) => !doProjeto.includes(agent))],
    [doProjeto, agents],
  );

  const [escolhido, setEscolhido] = useState<string | null>(null);
  const agentId = escolhido ?? opcoes[0]?.id ?? null;
  const { data: agent } = useAgent(agentId ?? undefined);

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={5} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Projeto não encontrado.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FlaskConical aria-hidden className="size-5 text-text-muted" />
            Testar Agente
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Conversa com o negócio deste projeto carregado — ofertas, públicos, diferenciais e
            regras. Sem o recorte de uma campanha. Não entra em métrica nem em publicação.
          </p>
        </div>

        {opcoes.length > 1 && (
          <label className="flex items-center gap-2 text-[13px] text-text-muted">
            <span className="sr-only">Agente</span>
            <select
              value={agentId ?? ''}
              onChange={(event) => setEscolhido(event.target.value)}
              className="min-w-0 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              {opcoes.map((opcao) => (
                <option key={opcao.id} value={opcao.id}>
                  {opcao.name}
                  {doProjeto.includes(opcao) ? '' : ' (fora deste projeto)'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!agentId && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Esta conta ainda não tem agente para testar. Crie um em{' '}
            <Link to="/agentes" className="text-accent hover:underline">
              Agentes
            </Link>{' '}
            — ele passa a conhecer este negócio assim que a conversa acontecer aqui.
          </p>
        </Card>
      )}

      {/*
        O agente é da CONTA e serve qualquer projeto — testá-lo aqui não exige
        vínculo nenhum. Mas quem abre esta tela e encontra um agente que nunca
        vinculou precisa saber de onde ele veio, e onde o vínculo de fato mora:
        na campanha, que é onde se decide quem fala com o cliente.
      */}
      {agentId && doProjeto.length === 0 && (
        <p className="mt-3 text-[13px] text-text-subtle">
          Nenhuma campanha deste projeto tem agente vinculado ainda — este é um agente da conta,
          carregado aqui com o negócio do projeto. O vínculo acontece na campanha.
        </p>
      )}

      {agentId && (
        <div className="mt-5 min-h-0 flex-1">
          <AgentLab
            key={agentId}
            agentId={agentId}
            projectId={project.id}
            fill
            autoOpen={agent?.configuration?.canonical.engagement.initiator === 'AGENT'}
            {...(agent?.configuration ? { configVersion: agent.configuration.versionNumber } : {})}
          />
        </div>
      )}
    </div>
  );
}
