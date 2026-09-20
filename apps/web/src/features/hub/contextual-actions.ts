/**
 * ContextualActionRegistry (§31).
 *
 * A saudação e as quick actions do MyAIHub dependem da rota e do estado da UI —
 * e são resolvidas EM CÓDIGO, nunca por chamada ao LLM. Perguntar ao modelo
 * quais botões desenhar custaria latência, tokens e dinheiro para produzir algo
 * que já é determinístico.
 *
 * O LLM só entra quando existe interação inteligente de verdade.
 */

// O escopo vem do CONTRATO compartilhado. Ele estava duplicado aqui, e a cópia
// ficou para trás quando PLAYBOOK entrou — o sintoma é sempre o mesmo: um lado
// aceita o valor novo e o outro nem sabe que ele existe.
export type { HubScope } from '@myaihub/shared';
import type { HubScope } from '@myaihub/shared';

export interface QuickAction {
  id: string;
  label: string;
  /** Operação do MyAIHub OS que o clique dispara. */
  operation: string;
  /**
   * Início de frase que a ação insere no composer.
   *
   * A ação não ENVIA sozinha: ela reduz a folha em branco e deixa o usuário
   * completar. Enviar um texto que ele não escreveu produziria configuração
   * que ele não pediu.
   */
  prompt?: string;
}

export interface HubContext {
  scope: HubScope;
  /**
   * Entidade do escopo, derivada da MESMA rota que decidiu o escopo.
   *
   * Antes o painel extraía isso com uma regex própria, que devolvia o id do
   * PROJETO numa rota de campanha — a conversa dizia escopo CAMPAIGN e mandava
   * o id errado junto. Uma única função decide as duas coisas.
   */
  scopeId?: string;
  greeting: string;
  /** Frase curta abaixo da saudação. Opcional — silêncio é melhor que ruído. */
  subtitle?: string;
  actions: QuickAction[];
}

export interface ContextualActionInput {
  pathname: string;
  /** Primeiro nome do usuário, para a saudação. */
  firstName: string;
  /** Falso quando a conta ainda não tem nenhum projeto (§12 do prompt). */
  hasProjects: boolean;
}

const PROJECT_ROUTE = /^\/projetos\/([^/]+)/;
const BRAND_ROUTE = /^\/projetos\/([^/]+)\/identidade\/?$/;
const PLAYBOOK_ROUTE = /^\/admin\/playbooks\/(?!novo)([^/]+)/;
const PLAYBOOK_LIST_ROUTE = /^\/admin\/playbooks\/?$/;
const CAMPAIGN_ROUTE = /^\/projetos\/([^/]+)\/campanhas\/([^/]+)/;
const CAMPAIGN_LIST_ROUTE = /^\/projetos\/([^/]+)\/campanhas\/?$/;
const AGENT_ROUTE = /^\/agentes\/([^/]+)/;

export function resolveHubContext(input: ContextualActionInput): HubContext {
  // O playbook é escopo de PLATAFORMA: quem conversa aqui é o admin, e o que
  // ele decide nasce dentro de todo agente daquele papel, em toda conta.
  // A LISTAGEM vem antes do playbook específico: ali o alvo ainda não existe,
  // e é de lá que o OS escreve o ofício que falta.
  if (PLAYBOOK_LIST_ROUTE.test(input.pathname)) {
    return {
      scope: 'PLAYBOOK',
      greeting: 'Qual ofício está faltando?',
      subtitle: 'Eu leio a pauta — os papéis que chegaram sem playbook — e escrevo o ofício.',
      actions: [
        {
          id: 'write-playbook',
          label: 'Escrever o ofício que falta',
          operation: 'playbook.create',
          prompt: 'Escreva o playbook mais pedido da pauta',
        },
        {
          id: 'write-playbook-for',
          label: 'Escrever um ofício específico',
          operation: 'playbook.create',
          prompt: 'Escreva o playbook para o papel de ',
        },
      ],
    };
  }

  const playbook = PLAYBOOK_ROUTE.exec(input.pathname);
  if (playbook?.[1]) {
    return {
      scope: 'PLAYBOOK',
      scopeId: playbook[1],
      greeting: 'O que calibramos neste ofício?',
      subtitle: 'Eu localizo o que muda e mexo só nisso — o resto fica como está.',
      actions: [
        {
          id: 'reinforce',
          label: 'Reforçar um comportamento',
          operation: 'playbook.refine',
          prompt: 'Está falhando em ',
        },
        {
          id: 'limit',
          label: 'Acrescentar um limite',
          operation: 'playbook.refine',
          prompt: 'Ele nunca pode ',
        },
        {
          id: 'question',
          label: 'Ajustar as perguntas',
          operation: 'playbook.refine',
          prompt: 'No briefing deste papel, pergunte também ',
        },
        {
          id: 'recognition',
          label: 'Reconhecer outros papéis',
          operation: 'playbook.refine',
          prompt: 'Este playbook também deveria cobrir ',
        },
      ],
    };
  }

  const campaign = CAMPAIGN_ROUTE.exec(input.pathname);
  if (campaign?.[2]) {
    return {
      scope: 'CAMPAIGN',
      scopeId: campaign[2],
      greeting: 'O que vamos ajustar nesta campanha?',
      subtitle: 'Descreva a mudança — eu reescrevo a estratégia e versiono.',
      actions: [
        {
          id: 'audience',
          label: 'Ajustar público',
          operation: 'campaign.refine_strategy',
          prompt: 'Esta campanha fala com ',
        },
        {
          id: 'discovery',
          label: 'Definir o que descobrir',
          operation: 'campaign.refine_strategy',
          prompt: 'Antes de propor, o agente precisa descobrir ',
        },
        {
          id: 'rule',
          label: 'Regra da campanha',
          operation: 'campaign.refine_strategy',
          prompt: 'Nesta campanha ele nunca pode ',
        },
        {
          id: 'cta',
          label: 'Configurar CTA',
          operation: 'campaign.configure_cta',
          prompt: 'Quando a pessoa estiver pronta, ofereça ',
        },
      ],
    };
  }

  // A listagem de campanhas é escopo de PROJETO: a campanha ainda não existe, e
  // o id que a operação recebe é o do projeto que vai contê-la.
  const campaignList = CAMPAIGN_LIST_ROUTE.exec(input.pathname);
  if (campaignList?.[1]) {
    return {
      scope: 'PROJECT',
      scopeId: campaignList[1],
      greeting: 'Vamos criar uma campanha?',
      subtitle: 'Diga o objetivo e com quem ela fala — eu monto a estratégia.',
      actions: [
        {
          id: 'create-campaign',
          label: 'Criar campanha',
          operation: 'campaign.create',
          prompt: 'Quero uma campanha para ',
        },
      ],
    };
  }

  const agent = AGENT_ROUTE.exec(input.pathname);
  if (agent?.[1]) {
    return {
      scope: 'AGENT',
      scopeId: agent[1],
      greeting: 'O que deseja ajustar neste agente?',
      subtitle: 'Descreva em linguagem natural — eu cuido da parte técnica.',
      actions: [
        {
          id: 'communication',
          label: 'Ajustar comunicação',
          operation: 'agent.configure',
          prompt: 'Quero ajustar a forma como ele se comunica: ',
        },
        {
          id: 'personality',
          label: 'Ajustar personalidade',
          operation: 'agent.configure',
          prompt: 'Quero ajustar a personalidade dele: ',
        },
        {
          id: 'skill',
          label: 'Adicionar skill',
          operation: 'agent.configure',
          prompt: 'Ele precisa saber ',
        },
        {
          id: 'rule',
          label: 'Definir regra ou limite',
          operation: 'agent.configure',
          prompt: 'Ele nunca pode ',
        },
      ],
    };
  }

  if (input.pathname.startsWith('/agentes')) {
    return {
      scope: 'ROOT',
      greeting: 'Vamos criar um agente?',
      subtitle: 'Descreva quem ele é e o que precisa saber fazer.',
      actions: [
        {
          id: 'create-agent',
          label: 'Criar agente',
          operation: 'agent.create',
          prompt: 'Quero um agente que ',
        },
      ],
    };
  }

  // A marca ANTES do projeto genérico: as duas são escopo PROJECT, mas a tela
  // da identidade não deve oferecer "informar sobre o negócio" como primeira
  // ação. Foi exatamente esse tipo de ação fora de lugar que já disparou a
  // operação errada com o id certo de outra coisa.
  const brand = BRAND_ROUTE.exec(input.pathname);
  if (brand?.[1]) {
    return {
      scope: 'PROJECT',
      scopeId: brand[1],
      greeting: 'Como esta marca deve se apresentar?',
      subtitle:
        'O tom vale para todo agente do projeto; cor, logo e rodapé ficam na página pública.',
      actions: [
        {
          id: 'brand-voice',
          label: 'Ajustar o tom de voz',
          operation: 'project.refine_brand',
          prompt: 'Quero que ele soe ',
        },
        {
          id: 'brand-look',
          label: 'Mudar a aparência',
          operation: 'project.refine_brand',
          prompt: 'A identidade visual deveria ser ',
        },
        {
          id: 'brand-tagline',
          label: 'Escrever a tagline',
          operation: 'project.refine_brand',
          prompt: 'Escreva uma tagline que diga o que o negócio faz',
        },
      ],
    };
  }

  const project = PROJECT_ROUTE.exec(input.pathname);
  if (project?.[1]) {
    return {
      scope: 'PROJECT',
      scopeId: project[1],
      greeting: 'O que você sabe sobre este negócio?',
      subtitle: 'Cole o que tiver — eu separo, gravo na seção certa e digo o que muda.',
      actions: [
        // A primeira é a que o usuário mais usa e a que menos existia: ele chega
        // com o institucional, o catálogo e as regras de uma vez, em texto
        // corrido. Quem separa é o OS.
        {
          id: 'add-knowledge',
          label: 'Informar sobre o negócio',
          operation: 'project.refine_profile',
          prompt: 'Sobre o negócio: ',
        },
        {
          id: 'business-rule',
          label: 'Definir regra de negócio',
          operation: 'project.refine_profile',
          prompt: 'Regra que vale para qualquer agente deste projeto: ',
        },
        // Sem conteúdo novo: o OS lê o que já existe e melhora. Roteada para o
        // refinamento, uma mensagem sem informação faria o modelo INVENTAR fato
        // do negócio só para ter o que gravar.
        {
          id: 'organize',
          label: 'Organizar o workspace',
          operation: 'project.organize_workspace',
          prompt: 'Analise este projeto e organize o que estiver fora do lugar',
        },
        {
          id: 'create-campaign',
          label: 'Criar campanha',
          operation: 'campaign.create',
          prompt: 'Quero uma campanha para ',
        },
      ],
    };
  }

  if (!input.hasProjects) {
    return {
      scope: 'ROOT',
      greeting: 'Olá!',
      subtitle: 'Vamos criar seu primeiro projeto?',
      actions: [
        {
          id: 'create-project',
          label: '+ Criar novo projeto',
          // `project.create` não existe no backend: a operação é
          // `project.create_from_brief`. O botão mais importante do produto
          // — o primeiro que um usuário novo vê — devolvia 4xx.
          operation: 'project.create_from_brief',
          prompt: 'Meu negócio é ',
        },
      ],
    };
  }

  return {
    scope: 'ROOT',
    greeting: `Olá, ${input.firstName}`,
    actions: [
      {
        id: 'create-project',
        label: 'Criar projeto',
        operation: 'project.create_from_brief',
        prompt: 'Meu negócio é ',
      },
      {
        id: 'create-agent',
        label: 'Criar agente',
        operation: 'agent.create',
        prompt: 'Quero um agente que ',
      },
    ],
  };
}
