/**
 * AÇÕES DO SISTEMA — o que existe na tela e não é documento versionado.
 *
 * O S.O sabia MUTAR configuração (perfil, agente, campanha, marca, ofício) e
 * nada além disso. Tudo o que a tela faz fora do canônico — vincular o agente
 * a uma campanha, publicar, cadastrar conhecimento, excluir, trocar modelo —
 * ficava fora do alcance dele. Pedido "vincula o Alex no Sankar", ele respondeu
 * explicando onde clicar: o sistema operacional devolvendo ao usuário o
 * trabalho que ele tem capacidade de fazer.
 *
 * A fronteira do S.O é a fronteira do SISTEMA. Se uma ação existe para o
 * usuário, existe para ele.
 *
 * Por que não são `MyAIHubOperation`: operação é modelo escrevendo mutação
 * tipada num documento versionado, com policy, contexto e contrato de saída.
 * Aqui não há nada a escrever — há uma decisão (QUAL campanha, QUAL agente) e um
 * comando. A decisão é do roteador, que já resolve nome em id pelo inventário;
 * o comando é o MESMO use case que a tela chama. Passar por `hub.reasoning`
 * custaria dezenas de segundos para produzir um clique.
 */

/** Os tipos de entidade que o S.O resolve por id, a partir do inventário. */
export type EntityKind = 'PROJECT' | 'AGENT' | 'CAMPAIGN' | 'PLAYBOOK' | 'KNOWLEDGE';

/** O alvo de uma ação: uma entidade da conta, ou um papel de modelo da plataforma. */
export type ActionTarget = EntityKind | 'MODEL_ROLE';

export interface SystemActionSpec {
  /** Nome estável, no mesmo formato das operações: `<agregado>.<verbo>`. */
  name: string;
  /** Progresso, no painel — o mesmo papel do `label` das operações. */
  label: string;
  /** O que ela FAZ — é por isto que o roteador escolhe. */
  purpose: string;
  /** Tipo do id principal (`targetId`). */
  target: ActionTarget;
  /** Segundo id, quando a ação liga duas coisas. */
  secondary?: { kind: EntityKind; meaning: string };
  /** Valor livre, curto — uma URL, um "provider:modelo". */
  value?: { meaning: string };
  /**
   * Irreversível. Só roda com confirmação explícita do usuário no turno
   * anterior — o roteador pode errar de entidade, e aqui errar apaga.
   */
  destructive?: boolean;
  /** Afeta a plataforma inteira: só o admin. Checado de novo no use case. */
  adminOnly?: boolean;
}

export const SYSTEM_ACTIONS: readonly SystemActionSpec[] = [
  {
    name: 'campaign.bind_agent',
    label: 'Vinculando o agente',
    purpose:
      'VINCULA um agente existente a uma campanha: ele passa a ser quem atende ali. É assim que um agente passa a atuar num PROJETO — pela campanha dele. Pedido "vincula o agente X no projeto Y" é esta ação, na campanha desse projeto.',
    target: 'CAMPAIGN',
    secondary: { kind: 'AGENT', meaning: 'o agente que vai atender a campanha' },
  },
  {
    name: 'campaign.unbind_agent',
    label: 'Desvinculando o agente',
    purpose: 'DESVINCULA o agente de uma campanha: ela fica sem ninguém atendendo.',
    target: 'CAMPAIGN',
  },
  {
    name: 'campaign.publish',
    label: 'Publicando a campanha',
    purpose:
      'PUBLICA uma campanha (ou republica): congela a configuração atual e põe o chat público no ar. Só quando o usuário pedir para publicar/colocar no ar.',
    target: 'CAMPAIGN',
  },
  {
    name: 'agent.sync_craft',
    label: 'Atualizando pelo ofício',
    purpose:
      'ATUALIZA um agente pelo ofício (playbook) mais recente, aplicando o texto curado sem reescrever o que o usuário calibrou.',
    target: 'AGENT',
  },
  {
    name: 'agent.delete',
    label: 'Excluindo o agente',
    purpose:
      'EXCLUI um agente, com as versões. Irreversível. Recusado se ele atende alguma campanha.',
    target: 'AGENT',
    destructive: true,
  },
  {
    name: 'knowledge.add_url',
    label: 'Cadastrando a página',
    purpose:
      'CADASTRA uma página (URL) no conhecimento de um projeto QUE JÁ EXISTE e já lê o conteúdo. Criar projeto a partir de um site NÃO é isto.',
    target: 'PROJECT',
    value: { meaning: 'a URL completa, copiada da mensagem' },
  },
  {
    name: 'knowledge.add_text',
    label: 'Guardando o texto',
    purpose:
      'CADASTRA um TEXTO que o usuário colou na mensagem como fonte de conhecimento de um projeto. O texto é guardado como ele escreveu, sem resumo.',
    target: 'PROJECT',
    value: {
      meaning:
        'as PRIMEIRAS 6 a 10 palavras do texto a guardar, copiadas exatamente — o sistema recorta a mensagem a partir delas',
    },
  },
  {
    name: 'knowledge.replace_text',
    label: 'Atualizando o texto',
    purpose:
      'SUBSTITUI o conteúdo de uma fonte de conhecimento de TEXTO pelo texto novo que o usuário colou na mensagem, sem resumo.',
    target: 'KNOWLEDGE',
    value: {
      meaning:
        'as PRIMEIRAS 6 a 10 palavras do texto novo, copiadas exatamente — o sistema recorta a mensagem a partir delas',
    },
  },
  {
    name: 'knowledge.reindex',
    label: 'Relendo a fonte',
    purpose: 'RELÊ uma fonte de conhecimento já cadastrada, para pegar o conteúdo atual.',
    target: 'KNOWLEDGE',
  },
  {
    name: 'knowledge.remove',
    label: 'Removendo a fonte',
    purpose: 'REMOVE uma fonte de conhecimento de um projeto. Irreversível.',
    target: 'KNOWLEDGE',
    destructive: true,
  },
  {
    name: 'model.set_route',
    label: 'Trocando o modelo',
    purpose:
      'TROCA o modelo de IA que atende um papel (hub.reasoning, hub.fast, agent.runtime, validation.fast, analysis.vision). Afeta a plataforma inteira.',
    target: 'MODEL_ROLE',
    value: { meaning: 'provider e modelo no formato "provider:modelo", do catálogo' },
    adminOnly: true,
  },
];

export function getSystemAction(name: string): SystemActionSpec | undefined {
  return SYSTEM_ACTIONS.find((action) => action.name === name);
}
