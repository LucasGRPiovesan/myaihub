import type { TenantContext } from '../../../shared/application/tenant-context.js';

/**
 * A EVIDÊNCIA de campo: o que aconteceu de fato nas conversas públicas.
 *
 * Existe porque o OS diagnosticava com uma mão amarrada. Ele lia o transcrito do
 * LAB — a conversa de teste que o usuário está olhando — e nada mais. As
 * conversas reais, com gente de verdade, ficavam no banco desde a Fase 8 e ele
 * não as enxergava: a Fase 10 contava "3 violações da regra X" numa tela, e a
 * única forma de o OS saber disso era o usuário narrar.
 *
 * É a diferença entre "acho que ele está prometendo prazo" e "esta regra falhou
 * 4 vezes esta semana, aqui está a fala". Diante da primeira o OS reescreve a
 * regra no escuro — foi o que produziu nove versões seguidas do mesmo ofício
 * tentando a mesma correção. Diante da segunda ele tem o caso.
 *
 * O que NÃO atravessa: a conversa inteira. Só a fala que violou e a pergunta
 * imediatamente anterior, que é o mínimo para entender o gatilho. Despejar
 * atendimentos completos no contexto encheria o orçamento com conversa que não
 * falha — e o que ensina é a que falhou.
 */
export interface ViolationEvidence {
  /** O checker que falhou. É por ele que a Fase 10 agrega. */
  check: string;
  /** Quantas vezes, na janela lida. Repetição é o sinal de que a regra não pega. */
  count: number;
  /** O caso mais recente: o que o interlocutor disse e o que o agente respondeu. */
  sample: { prompt: string | null; reply: string; at: Date };
}

export interface EvidenceReader {
  /**
   * As regras que mais falharam nas conversas PÚBLICAS deste agente.
   *
   * Só o canal público: violação no Lab é o usuário testando propositalmente o
   * limite, e contá-la como falha de produção mandaria o OS corrigir um
   * comportamento que ninguém viu acontecer com um cliente.
   */
  violationsByAgent(
    context: TenantContext,
    agentId: string,
    limit: number,
  ): Promise<ViolationEvidence[]>;
}
