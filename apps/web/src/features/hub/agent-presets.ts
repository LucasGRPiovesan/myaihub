/**
 * Papéis prontos para o usuário escolher em vez de escrever do zero.
 *
 * O que cada um contém é INTENÇÃO em português, não prompt: o preset preenche o
 * composer com a frase que o usuário diria se soubesse formulá-la, e a partir
 * dali é o MyAIHub OS que faz a engenharia — mesma operação, mesmo pipeline.
 *
 * Deliberadamente NÃO é template de configuração. Um `if (papel === 'X')` que
 * devolvesse facetas prontas mataria a tese do produto: a competência tem que
 * sair do OS, não de uma tabela que alguém mantém à mão. O preset economiza
 * digitação; a inteligência continua sendo derivada.
 *
 * Por isso cada `prompt` termina em aberto: o usuário completa com o que só ele
 * sabe — o negócio dele.
 */
export interface AgentPreset {
  id: string;
  label: string;
  /** Uma linha sobre o que este agente faz, para escolher sem adivinhar. */
  hint: string;
  prompt: string;
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'comercial',
    label: 'Comercial estratégico',
    hint: 'Descobre a necessidade antes de propor e conduz até a decisão.',
    prompt:
      'Quero um representante comercial estratégico, que entenda a situação da pessoa antes ' +
      'de propor qualquer coisa. Ele vende ',
  },
  {
    id: 'atendente-site',
    label: 'Atendente de site',
    hint: 'Tira dúvidas de quem chega pelo site e encaminha quem está pronto.',
    prompt:
      'Quero um atendente para o site institucional, que responda dúvidas de quem chega ' +
      'pela primeira vez. A empresa é ',
  },
  {
    id: 'recepcionista',
    label: 'Recepcionista',
    hint: 'Recebe, identifica o motivo do contato e direciona.',
    prompt:
      'Quero um recepcionista que receba as pessoas, entenda o motivo do contato e ' +
      'direcione para o lugar certo. O atendimento é de ',
  },
  {
    id: 'restaurante',
    label: 'Atendente de restaurante',
    hint: 'Cardápio, pedidos e reservas, no tom da casa.',
    prompt:
      'Quero um atendente de restaurante para tirar dúvidas do cardápio e ajudar com ' +
      'pedidos e reservas. O restaurante é ',
  },
  {
    id: 'suporte',
    label: 'Suporte técnico',
    hint: 'Resolve o que dá para resolver e escala o resto com contexto.',
    prompt:
      'Quero um agente de suporte técnico que tente resolver antes de escalar, e que ' +
      'escale com o contexto já coletado. O produto é ',
  },
  {
    id: 'qualificacao',
    label: 'Qualificação de leads',
    hint: 'Separa quem tem fit de quem não tem, sem constranger ninguém.',
    prompt:
      'Quero um agente que qualifique leads: descobrir se a pessoa tem perfil antes de ' +
      'passar para o time. O critério de fit é ',
  },
];
