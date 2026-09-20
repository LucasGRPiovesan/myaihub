import { FlaskConical } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { SkeletonText } from '../../design-system/feedback';
import { Card } from '../../design-system/primitives';
import { AgentLab } from '../agents/AgentLab';
import { useAgent } from '../agents/agents.api';
import { useCampaign } from './campaigns.api';

/**
 * O Lab interno, com o contexto da CAMPANHA (§17 Fase 8).
 *
 * É a mesma conversa da tela do agente, e de propósito: dois laboratórios
 * seriam dois comportamentos para a mesma pergunta ("como ele responde?"), e o
 * segundo nunca receberia as correções que o primeiro recebeu.
 *
 * O que muda é o CONTEXTO, e isso muda o teste inteiro. Direto no agente o
 * usuário precisa escrever um cenário à mão, porque não existe negócio nenhum
 * em volta — sem isso o teste media a imaginação do modelo. Pela campanha o
 * cenário já existe: ela e o projeto dizem o negócio, o público e o objetivo,
 * e o `compileAgentPrompt` ignora o cenário escrito justamente por isso. Aqui
 * se testa o que o público vai receber, não uma aproximação dele.
 */
export function CampaignLabPage() {
  const { projectId, campaignId } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);
  const { data: agent } = useAgent(campaign?.agent?.id);

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={5} />
      </div>
    );
  }

  if (isError || !campaign) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Campanha não encontrada.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FlaskConical aria-hidden className="size-5 text-text-muted" />
            Testar Agente
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {campaign.agent ? (
              <>
                Conversa com{' '}
                <Link to={`/agentes/${campaign.agent.id}`} className="text-accent hover:underline">
                  {campaign.agent.name}
                </Link>{' '}
                no contexto desta campanha. Não entra em métrica nem em publicação.
              </>
            ) : (
              'Esta campanha ainda não tem agente vinculado.'
            )}
          </p>
        </div>
      </div>

      {!campaign.agent && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Vincule um agente à campanha para testar. Peça ao MyAIHub no painel, ou volte para{' '}
            <Link
              to={`/projetos/${projectId}/campanhas/${campaign.id}`}
              className="text-accent hover:underline"
            >
              a visão geral
            </Link>
            .
          </p>
        </Card>
      )}

      {campaign.agent && (
        <div className="mt-5 min-h-0 flex-1">
          <AgentLab
            agentId={campaign.agent.id}
            campaignId={campaign.id}
            fill
            // O agente abre sozinho quando a configuração diz que a iniciativa
            // é dele — a mesma regra da tela do agente, lida do mesmo lugar.
            autoOpen={agent?.configuration?.canonical.engagement.initiator === 'AGENT'}
            {...(agent?.configuration ? { configVersion: agent.configuration.versionNumber } : {})}
          />
        </div>
      )}
    </div>
  );
}
