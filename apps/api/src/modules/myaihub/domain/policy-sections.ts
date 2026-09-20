/**
 * As seções de policy que TODA operação carrega.
 *
 * Existiam seis listas independentes — uma por operação — e a consequência era
 * previsível: a seção nova entrava em quatro delas e faltava nas outras duas,
 * sem que nada acusasse em execução (o runner PULA seção ausente em silêncio).
 * Aconteceu duas vezes seguidas, com `diagnosis` e com `examples`. A pergunta
 * "isto vale para toda operação?" passa a ter uma resposta só, e ela é esta.
 *
 * Entra aqui o que independe do que está sendo configurado: conversar em vez de
 * executar, ler um relato de falha, entender um exemplo, saber a que NÍVEL uma
 * informação pertence. O que é específico do alvo — `project_profile`,
 * `agent_taxonomy`, `campaign_strategy` — cada operação acrescenta.
 */
export const BASE_POLICY_SECTIONS = [
  'core',
  'conversation',
  'examples',
  'diagnosis',
  'information_level',
  // O par de "information_level": aquela diz a que nível uma informação
  // pertence; esta diz que fato do INTERLOCUTOR não pertence a nível nenhum.
  // Vale para agente, projeto e campanha — o vazamento é o mesmo nos três.
  'ephemeral_facts',
  'intent_interpretation',
  // O que o sistema CONSEGUE fazer. Sem ela, escrever "ele envia o e-mail"
  // parecia configurar um envio — e o agente passava a prometê-lo ao cliente.
  'system_capabilities',
  // A FORMA da resposta é informação. Comparativo é tabela, itens são lista, e
  // achatar os dois em prosa devolve ao usuário o trabalho de reconstruir a
  // estrutura que o modelo já tinha produzido.
  'presentation',
] as const;
