import { compileAgentPrompt } from '../domain/agent-prompt.js';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import type { SessionRepository } from '../../conversations/domain/repositories.js';
import type { AgentRepository } from '../domain/repositories.js';
import type {
  AgentRehearsal,
  RehearsalInput,
  RehearsalOutcome,
} from '../../myaihub/application/agent-rehearsal.js';

/**
 * O S.O TESTA o que acabou de configurar — antes de dizer que está pronto.
 *
 * Esta é a diferença entre um sistema que edita documento e um que responde
 * pelo comportamento. Até aqui o painel dizia "ajustei" no instante em que
 * gravava a versão, e quem descobria se a correção pegou era o usuário, no
 * teste seguinte, de graça para o sistema e caro para ele: onze versões de um
 * agente, seis reclamando da mesma coisa, e nenhuma etapa do processo em que
 * alguém tenha REEXECUTADO a conversa para conferir.
 *
 * O que se faz aqui é o que o usuário fazia à mão: pega a MESMA fala que
 * produziu a queixa, roda contra a configuração nova, e olha a resposta.
 *
 * Duas decisões que importam:
 *
 *   · NÃO persiste conversa. É ensaio, não atendimento: gravá-lo apareceria no
 *     Lab como uma conversa que o usuário não teve, e no relatório como um
 *     turno que ninguém pediu.
 *   · O juiz recebe a REGRA e a QUEIXA, nunca o veredito esperado. Perguntar
 *     "ficou bom?" devolve "sim" — o que se pergunta é se a resposta ainda faz
 *     a coisa específica de que o usuário reclamou.
 */

const veredictoSchema = z.object({
  /**
   * PRIMEIRO e curto, antes da justificativa.
   *
   * O modelo escreve o JSON na ordem do schema, e campo decisório depois de
   * texto longo é campo que às vezes não chega a ser escrito.
   */
  aindaFalha: z.boolean(),
  evidencia: z.string().trim().max(400).default(''),
});

export class AgentRehearsalService implements AgentRehearsal {
  constructor(
    private readonly deps: {
      agents: AgentRepository;
      sessions: SessionRepository;
      gateway: LlmGateway;
    },
  ) {}

  async rehearse(context: TenantContext, input: RehearsalInput): Promise<RehearsalOutcome> {
    const agent = await this.deps.agents.findById(context, input.agentId);
    const canonical = agent?.version?.canonicalConfig;
    if (!canonical) {
      return {
        status: 'SKIPPED',
        reason: 'agente sem configuração',
        costMicros: 0,
        totalTokens: 0,
      };
    }

    // A última fala do INTERLOCUTOR é a que provocou o erro; o que veio antes
    // dela é o histórico que a torna compreensível. Repetir a conversa inteira
    // testaria outra coisa — o começo dela já tinha passado.
    const ultimaFala = [...input.transcript].reverse().find((turn) => turn.role === 'user');
    if (!ultimaFala) {
      return {
        status: 'SKIPPED',
        reason: 'a conversa de teste não tem fala do interlocutor',
        costMicros: 0,
        totalTokens: 0,
      };
    }

    const anteriores = input.transcript.slice(0, input.transcript.lastIndexOf(ultimaFala));

    // O MESMO cenário do teste que o usuário estava rodando. Sem ele o ensaio
    // mede a imaginação do modelo, que é justamente o que o cenário evita.
    const [sessao] = await this.deps.sessions.list(context, {
      channel: 'LAB',
      agentId: input.agentId,
      limit: 1,
      cursor: null,
    });

    const prompt = compileAgentPrompt({
      agent: canonical,
      ...(sessao?.scenario ? { testScenario: sessao.scenario } : {}),
    });

    const resposta = await this.deps.gateway.generate(context, {
      role: 'agent.runtime',
      blocks: [
        {
          id: 'agent.runtime.prompt',
          kind: 'STABLE',
          trust: 'TRUSTED',
          priority: 100,
          cacheable: true,
          content: prompt,
        },
      ],
      messages: [...anteriores, { role: 'user' as const, content: ultimaFala.content }],
      params: { temperature: 0.6 },
      tokenBudget: 12_000,
    });

    const veredito = await this.judge(context, {
      complaint: input.complaint,
      rules: input.rules,
      pergunta: ultimaFala.content,
      resposta: resposta.content,
    });

    return {
      status: veredito.aindaFalha ? 'FAILED' : 'PASSED',
      reply: resposta.content,
      evidence: veredito.evidencia,
      costMicros: resposta.costMicros + veredito.costMicros,
      totalTokens: resposta.totalTokens + veredito.totalTokens,
    };
  }

  /**
   * O juiz é uma chamada CURTA e barata, com a regra na mão.
   *
   * Roda no papel `validation.fast`, que tem corrida de pedido: um veredito de
   * mil tokens não pode ser o passo lento de uma operação que já pagou o
   * raciocínio inteiro.
   */
  private async judge(
    context: TenantContext,
    input: {
      complaint: string;
      rules: Array<{ code: string; statement: string }>;
      pergunta: string;
      resposta: string;
    },
  ): Promise<{ aindaFalha: boolean; evidencia: string; costMicros: number; totalTokens: number }> {
    const instrucao = [
      'Você confere se uma correção de configuração PEGOU.',
      '',
      'O usuário reclamou disto, nas palavras dele:',
      input.complaint,
      '',
      'As regras que acabaram de ser escritas ou ajustadas para resolver isso:',
      ...input.rules.map((rule) => `- [${rule.code}] ${rule.statement}`),
      '',
      'Abaixo está a MESMA situação, refeita agora com a configuração nova.',
      '',
      'Responda uma coisa só: a resposta do agente AINDA comete o erro de que o',
      'usuário reclamou? Julgue o comportamento observável, não a intenção — e',
      'não marque falha por assunto tocado, por estilo, nem por algo que a regra',
      'não proíbe. Marcando falha, cite o TRECHO exato como evidência.',
    ].join('\n');

    const resultado = await this.deps.gateway.generateStructured(
      context,
      {
        role: 'validation.fast',
        blocks: [
          {
            id: 'rehearsal.instruction',
            kind: 'POLICY',
            trust: 'TRUSTED',
            priority: 100,
            essential: true,
            cacheable: true,
            content: instrucao,
          },
          {
            // A fala do interlocutor e a resposta do agente são conteúdo, não
            // instrução: é exatamente aqui que caberia um "ignore o que veio
            // antes" (§9.1).
            id: 'rehearsal.turn',
            kind: 'UNTRUSTED',
            trust: 'UNTRUSTED',
            priority: 50,
            essential: true,
            cacheable: false,
            content: [`INTERLOCUTOR: ${input.pergunta}`, `AGENTE: ${input.resposta}`].join('\n'),
          },
        ],
        messages: [{ role: 'user', content: 'Confira e responda no formato pedido.' }],
        params: { temperature: 0 },
        tokenBudget: 8_000,
      },
      veredictoSchema,
    );

    return {
      aindaFalha: resultado.content.aindaFalha,
      evidencia: resultado.content.evidencia,
      costMicros: resultado.costMicros,
      totalTokens: resultado.totalTokens,
    };
  }
}
