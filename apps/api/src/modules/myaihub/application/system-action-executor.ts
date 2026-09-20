import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError } from '../../../shared/domain/errors.js';
import type { DeleteAgentUseCase } from '../../agents/application/delete-agent.use-case.js';
import type { ChangeModelRouteUseCase } from '../../ai/application/change-model-route.use-case.js';
import type { BindCampaignAgentUseCase } from '../../campaigns/application/bind-campaign-agent.use-case.js';
import type { PublishCampaignUseCase } from '../../campaigns/application/publish-campaign.use-case.js';
import type { ManageKnowledgeUseCase } from '../../projects/application/manage-knowledge.use-case.js';
import type { SystemActionSpec } from '../domain/system-action.js';
import type { SyncAgentCraftUseCase } from './sync-agent-craft.use-case.js';

/** O que o roteador resolveu para a ação: ids conferidos e nomes para a resposta. */
export interface SystemActionArgs {
  targetId: string;
  targetName: string;
  /** O projeto dono, quando o alvo é campanha ou conhecimento. */
  targetParentId?: string;
  secondaryId?: string;
  secondaryName?: string;
  value?: string;
  /** A mensagem inteira — é dela que o texto de conhecimento é recortado. */
  message: string;
}

export interface SystemActionOutcome {
  /** O que aconteceu, escrito por CÓDIGO: é fato, não opinião, e não custa token. */
  summary: string;
  /** A entidade que o usuário deve ver agora — o painel leva ele até lá. */
  entity?: {
    target: 'PROJECT' | 'AGENT' | 'CAMPAIGN';
    id: string;
    name: string;
    /** Deixou de existir: as telas recarregam, ninguém navega até ela. */
    removed?: boolean;
  };
}

type Handler = (context: TenantContext, args: SystemActionArgs) => Promise<SystemActionOutcome>;

/**
 * Onde o texto colado começa.
 *
 * O roteador devolve as primeiras palavras do texto, não o texto: copiar um
 * documento inteiro para dentro de um JSON custaria tokens de SAÍDA e voltaria
 * parafraseado — o mesmo erro que o conhecimento existe para não cometer. O
 * recorte é da mensagem que o usuário escreveu, byte a byte.
 */
export function sliceFromMarker(message: string, marker: string | undefined): string {
  const inicio = marker ? message.indexOf(marker.trim()) : -1;
  return (inicio >= 0 ? message.slice(inicio) : message).trim();
}

/** Primeira linha do texto, curta, como título da fonte. */
function titleOf(text: string): string {
  const linha = text.split('\n').find((item) => item.trim().length > 0) ?? 'Texto';
  const limpa = linha.trim();
  return limpa.length > 80 ? `${limpa.slice(0, 77)}...` : limpa;
}

/** A fonte mudou; quem mostra a lista dela é a tela do projeto. */
function projetoDono(args: SystemActionArgs): Pick<SystemActionOutcome, 'entity'> {
  return args.targetParentId
    ? { entity: { target: 'PROJECT', id: args.targetParentId, name: '' } }
    : {};
}

/**
 * Executa as ações do sistema pelo MESMO use case que a tela chama.
 *
 * Nenhuma lógica de negócio mora aqui — só a tradução de "o que o roteador
 * resolveu" para a chamada que a rota faria. Um segundo caminho para vincular
 * ou publicar seria o começo de dois comportamentos para a mesma coisa.
 */
export class SystemActionExecutor {
  private readonly handlers: Record<string, Handler>;

  constructor(deps: {
    bindAgent: BindCampaignAgentUseCase;
    publish: PublishCampaignUseCase;
    syncCraft: SyncAgentCraftUseCase;
    deleteAgent: DeleteAgentUseCase;
    knowledge: ManageKnowledgeUseCase;
    changeModel: ChangeModelRouteUseCase;
  }) {
    this.handlers = {
      'campaign.bind_agent': async (context, args) => {
        await deps.bindAgent.execute(context, args.targetId, args.secondaryId ?? null);
        return {
          summary: `Pronto: **${args.secondaryName}** agora atende a campanha **${args.targetName}**.`,
          entity: { target: 'CAMPAIGN', id: args.targetId, name: args.targetName },
        };
      },
      'campaign.unbind_agent': async (context, args) => {
        await deps.bindAgent.execute(context, args.targetId, null);
        return {
          summary: `Pronto: a campanha **${args.targetName}** ficou sem agente vinculado.`,
          entity: { target: 'CAMPAIGN', id: args.targetId, name: args.targetName },
        };
      },
      'campaign.publish': async (context, args) => {
        const result = await deps.publish.execute(context, args.targetId);
        return {
          summary:
            `Publiquei **${args.targetName}** (publicação nº ${result.deployment.deploymentNumber}). ` +
            `O chat público está em \`/c/${result.publicId}\`.`,
          entity: { target: 'CAMPAIGN', id: args.targetId, name: args.targetName },
        };
      },
      'agent.sync_craft': async (context, args) => {
        const result = await deps.syncCraft.execute(context, args.targetId);
        return {
          summary: `Atualizei **${args.targetName}** pelo ofício — versão ${result.versionNumber}.`,
          entity: { target: 'AGENT', id: args.targetId, name: args.targetName },
        };
      },
      'agent.delete': async (context, args) => {
        await deps.deleteAgent.execute(context, args.targetId);
        return {
          summary: `Excluí o agente **${args.targetName}**, com as versões dele.`,
          entity: { target: 'AGENT', id: args.targetId, name: args.targetName, removed: true },
        };
      },
      'knowledge.add_url': async (context, args) => {
        const uri = args.value?.trim() ?? '';
        const source = await deps.knowledge.create(context, args.targetId, {
          kind: 'URL',
          title: uri.replace(/^https?:\/\//, '').slice(0, 200),
          uri,
        });
        return {
          summary:
            source.status === 'FAILED'
              ? `Cadastrei ${uri} no conhecimento de **${args.targetName}**, mas não consegui ler a página: ${source.lastError ?? 'erro desconhecido'}. Dá para reindexar depois.`
              : `Cadastrei e li ${uri} no conhecimento de **${args.targetName}** (${source.contentLength} caracteres).`,
          entity: { target: 'PROJECT', id: args.targetId, name: args.targetName },
        };
      },
      'knowledge.add_text': async (context, args) => {
        const content = sliceFromMarker(args.message, args.value);
        const source = await deps.knowledge.create(context, args.targetId, {
          kind: 'TEXT',
          title: titleOf(content),
          content,
        });
        return {
          summary: `Guardei o texto no conhecimento de **${args.targetName}**, como você escreveu (${source.contentLength} caracteres).`,
          entity: { target: 'PROJECT', id: args.targetId, name: args.targetName },
        };
      },
      'knowledge.replace_text': async (context, args) => {
        const source = await deps.knowledge.replaceText(
          context,
          args.targetId,
          sliceFromMarker(args.message, args.value),
        );
        return {
          summary: `Troquei o texto de **${args.targetName}** pelo que você escreveu (${source.contentLength} caracteres).`,
          ...projetoDono(args),
        };
      },
      'knowledge.reindex': async (context, args) => {
        const source = await deps.knowledge.reindex(context, args.targetId);
        return {
          summary:
            source.status === 'FAILED'
              ? `Tentei reler **${args.targetName}** e falhou: ${source.lastError ?? 'erro desconhecido'}.`
              : `Reli **${args.targetName}** (${source.contentLength} caracteres).`,
          ...projetoDono(args),
        };
      },
      'knowledge.remove': async (context, args) => {
        await deps.knowledge.remove(context, args.targetId);
        return { summary: `Removi **${args.targetName}** do conhecimento.`, ...projetoDono(args) };
      },
      'model.set_route': async (context, args) => {
        const [provider = '', ...resto] = (args.value ?? '').split(':');
        const result = await deps.changeModel.execute(context, {
          role: args.targetId,
          provider: provider.trim(),
          model: resto.join(':').trim(),
        });
        return {
          summary:
            `O papel \`${result.role}\` passa a usar **${result.selected.model}**.` +
            (result.lockedToFreeTier
              ? ' Enquanto a cota gratuita estiver de pé ela continua servindo; a escolha vale quando ela acabar.'
              : ''),
        };
      },
    };
  }

  handles(name: string): boolean {
    return name in this.handlers;
  }

  async execute(
    context: TenantContext,
    action: SystemActionSpec,
    args: SystemActionArgs,
  ): Promise<SystemActionOutcome> {
    const handler = this.handlers[action.name];
    if (!handler) {
      throw new AppError('VALIDATION_ERROR', `Ação desconhecida: "${action.name}".`, {
        httpStatus: 422,
      });
    }
    return handler(context, args);
  }
}
