import { z } from 'zod';

/**
 * O que um turno do painel É: uma resposta ou uma alteração.
 *
 * Vive num módulo próprio porque as três famílias de operação montam a própria
 * saída (`agentOutputBase`, `campaignOutputBase`, `operationOutputSchema`) e
 * TODAS precisam dele — perguntar é possível em qualquer escopo. Deixar a
 * declaração repetida em três lugares é como uma delas fica de fora, e a
 * operação esquecida volta a alterar configuração quando o usuário só perguntou.
 *
 * A decisão vem do modelo, e não de heurística sobre o texto: a diferença entre
 * "ele já sabe mudar de abordagem?" e "faça ele mudar de abordagem" é de
 * SENTIDO, e nenhuma lista de palavras separa as duas de forma confiável.
 *
 * `CHANGE` é o default — uma saída antiga, sem o campo, continua sendo aplicada.
 */
/** Texto curto que o CÓDIGO corta no teto — ver `describedField`. */
function clippedField(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.length > max ? value.slice(0, max) : value),
    z.string().trim().min(1).max(max),
  );
}

export const intentField = {
  intent: z.enum(['CHANGE', 'ANSWER']).default('CHANGE'),
  /**
   * O pedido esbarrou num limite do SISTEMA — não do pedido.
   *
   * Existe para o S.O dizer "isto eu não consigo" de um jeito que CHEGA a
   * alguém: vira linha na pauta de suporte do admin, porque a correção é no
   * MyAIHub, não na configuração do usuário. Sem o campo, a limitação ficava
   * numa frase educada da resposta e morria ali.
   *
   * Junto do `intent` e antes do resto: é curto e decide o que acontece.
   */
  limitation: z
    .object({
      summary: clippedField(300),
      need: clippedField(600),
    })
    .optional(),
};

/**
 * Campo DESCRITIVO: passar do limite corta, nunca recusa a saída inteira.
 *
 * `interpretedIntent` é o resumo do que o OS entendeu — vai para o histórico e
 * para o `ConfigurationChange`, e não governa comportamento nenhum. Mesmo assim
 * ele era `.max(300)` puro, e uma frase de 310 caracteres derrubava a operação
 * COMPLETA: medido, duas chamadas pagas (761 e 604 tokens de saída) recusadas em
 * sequência, e o usuário lendo "saída estruturada não bate com o schema" depois
 * de esperar — por causa do tamanho de uma legenda.
 *
 * É o mesmo erro que o `plan` já tinha custado, e a lição de lá vale aqui: o
 * limite existe porque a coluna do banco é `VarChar(300)`, então ele precisa ser
 * respeitado — mas quem respeita é o CÓDIGO, cortando, não o modelo, acertando.
 *
 * `z.preprocess` e não `.transform()`: transform não sobrevive ao
 * `z.toJSONSchema`, e o schema é convertido ANTES de qualquer chamada.
 */
export function describedField(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.length > max ? value.slice(0, max) : value),
    z.string().trim().min(3).max(max),
  );
}

/**
 * A RESPOSTA AO USUÁRIO — longa quando precisa ser, e que NUNCA derruba o turno.
 *
 * Era `z.string().max(2000)` cru, e o limite não vinha de lugar nenhum: a
 * coluna é JSON, sem tamanho. Um número arbitrário que RECUSA a saída inteira
 * é o erro que este repositório já pagou duas vezes — `plan` com 80 e
 * `interpretedIntent` com 300, cada um custando um turno pago recusado por
 * causa do tamanho de um rótulo.
 *
 * E o risco cresceu junto com a seção `presentation`: agora que a resposta
 * pode ser uma TABELA comparativa, estourar 2000 caracteres deixou de ser
 * improvável. Quem respeita o teto é o CÓDIGO, cortando; nunca o modelo,
 * acertando.
 */
export function narrativeField(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.length > max ? value.slice(0, max) : value),
    z.string().trim().min(1).max(max),
  );
}
