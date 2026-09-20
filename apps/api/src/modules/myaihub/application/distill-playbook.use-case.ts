import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import { agentPlaybookSchema, type AgentPlaybook } from '../domain/playbook.js';
import { MASTER_POLICY_NAME } from '../domain/policy.js';
import type { PolicyRepository } from '../domain/repositories.js';

/**
 * Destila um documento em playbook de ofício.
 *
 * É o que faz o admin conseguir trazer 60KB de pesquisa sem que 60KB de
 * pesquisa virem prompt. O estudo é a FONTE; o playbook é a destilação, e a
 * diferença entre os dois é o que mantém o prompt de criação legível — instrução
 * longa esconde o contrato de saída, e isso já custou `identity` omitido.
 *
 * O pipeline é o mesmo de todo o produto: a LLM propõe, o schema valida, e uma
 * PESSOA aprova antes de virar versão. Nada aqui grava sozinho.
 */
export interface DistillPlaybookResult {
  playbook: AgentPlaybook;
  costMicros: number;
  totalTokens: number;
}

const INSTRUCTION = [
  'Você vai transformar o documento abaixo em um PLAYBOOK DE OFÍCIO: a baseline',
  'profissional de um papel, que o MyAIHub OS usa para projetar agentes.',
  '',
  'O que é um playbook: o destilado do que um EXCELENTE profissional daquele',
  'papel faz. Ele entra no contexto de quem configura o agente, e cada princípio',
  'dele vira um item de configuração.',
  '',
  '========== A SEPARAÇÃO QUE MAIS IMPORTA ==========',
  '',
  'Um estudo desses quase sempre mistura duas camadas. Só UMA vira playbook.',
  '',
  '  OFÍCIO TRANSFERÍVEL — como o profissional conduz, o que descobre antes de',
  '  propor, como trata objeção, o que nunca faz. Vale para qualquer empresa que',
  '  contrate alguém daquele papel. ISSO entra.',
  '',
  '  ARQUITETURA DE UM PRODUTO — máquina de estados, fases, telas, campos,',
  '  eventos, métricas, testes A/B, nomes de plano e de empresa. É a solução de',
  '  UM caso. ISSO NÃO ENTRA: engessaria o agente de todo mundo com o funil de',
  '  um só, e o mesmo modelo precisa servir atendente e recepcionista.',
  '',
  'Um mecanismo específico pode virar princípio se você o reescrever em nível de',
  'ofício. "Não deixe a fase bloquear quem pediu preço" é arquitetura; "quem',
  'pergunta preço quer preço: responda primeiro e só depois retome" é ofício.',
  '',
  '========== COMO ESCREVER CADA CAMPO ==========',
  '',
  '`principles`: de 8 a 18. Cada um DECLARA A FACETA em que entra, e a escolha',
  'muda o resultado — é ela que define quantos itens de cada tipo o agente terá:',
  '',
  '  personality    como o agente É            paciente, firme, curioso',
  '  communication  como ele SE COMUNICA       tamanho, formalidade, vocabulário',
  '  skills         o que ele SABE FAZER       diagnosticar, contornar objeção',
  '  behaviors      como ele AGE               confirma antes, resume ao final',
  '  strategies     abordagens disponíveis     construir valor, gerar implicação',
  '  hardRules      obrigações inegociáveis    sempre transferir quando pedirem',
  '',
  'Cada `statement` é uma INSTRUÇÃO acionável, em terceira pessoa, com o motivo',
  'embutido quando ele muda o comportamento. Não é um rótulo: "seja consultivo"',
  'não configura nada; "investiga a situação e as implicações do problema antes',
  'de apresentar qualquer solução" configura.',
  '',
  '`antiPatterns`: o que NUNCA fazer. Vira proibição do agente. Escreva o ato,',
  'não a virtude: "criar urgência que não existe", não "ser honesto".',
  '',
  '`alreadyAnswered`: o que o ofício já resolve, e por isso o sistema NÃO deve',
  'perguntar a quem cria o agente. Tom de voz, como tratar objeção, que perguntas',
  'fazer — tudo isso é trabalho do OS, não do usuário.',
  '',
  '`worthAsking`: de 2 a 4 perguntas que só quem opera o negócio sabe responder,',
  'e que valem em QUALQUER campanha daquele agente — setor, canal, fronteira de',
  'autonomia. Nunca produto, preço, público ou desconto: isso é da campanha e o',
  'agente pertence à conta. Cada uma com um `why` de uma linha.',
  '',
  '`appliesTo`: frases em linguagem natural pelas quais um classificador vai',
  'reconhecer o papel, incluindo sinônimos e variações de mercado.',
  '',
  '`sources`: de onde cada afirmação forte veio. Se o documento cita pesquisa,',
  'número ou metodologia, registre — é o que permite auditar depois.',
  '',
  '========== ANTES DE RESPONDER ==========',
  '',
  'Confira: sobrou algum nome de empresa, produto, plano ou preço do documento?',
  'Tire. O playbook descreve o OFÍCIO, e vai ser usado por contas que não têm',
  'nada a ver com o caso estudado.',
].join('\n');

export class DistillPlaybookUseCase {
  constructor(private readonly deps: { gateway: LlmGateway; policies: PolicyRepository }) {}

  async execute(
    context: TenantContext,
    input: { document: string; roleHint?: string | undefined; key?: string | undefined },
  ): Promise<DistillPlaybookResult> {
    const policy = await this.deps.policies.getCurrent(MASTER_POLICY_NAME);
    const taxonomy = policy?.sections['agent_taxonomy'];

    const generated = await this.deps.gateway.generateStructured(
      context,
      {
        // Destilar é julgamento denso sobre texto longo: é trabalho do papel de
        // raciocínio, não do rápido. E acontece UMA vez por playbook.
        role: 'hub.reasoning',
        blocks: [
          ...(taxonomy
            ? [
                {
                  id: 'policy.agent_taxonomy',
                  kind: 'POLICY' as const,
                  trust: 'TRUSTED' as const,
                  priority: 100,
                  cacheable: true,
                  content: taxonomy,
                },
              ]
            : []),
          {
            id: 'distill.instruction',
            kind: 'POLICY' as const,
            trust: 'TRUSTED' as const,
            priority: 95,
            cacheable: true,
            content: INSTRUCTION,
          },
          {
            // O documento é material de terceiro, não ordem: ele pode conter
            // qualquer coisa, inclusive texto que pareça instrução.
            id: 'distill.document',
            kind: 'UNTRUSTED' as const,
            trust: 'UNTRUSTED' as const,
            priority: 70,
            cacheable: false,
            content: input.roleHint
              ? `Papel pretendido: ${input.roleHint}\n\n---\n\n${input.document}`
              : input.document,
          },
        ],
        messages: [
          {
            role: 'user',
            content: 'Destile o documento acima em um playbook de ofício, seguindo a instrução.',
          },
        ],
        params: { temperature: 0.3 },
        // Um estudo de mercado passa fácil de 15 mil tokens, e cortá-lo pela
        // metade produziria um playbook que ignora justamente a parte final.
        tokenBudget: 120_000,
        ...(policy ? { policyVersionId: policy.id } : {}),
        policySections: ['agent_taxonomy'],
      },
      agentPlaybookSchema,
    );

    return {
      // A chave é decisão do admin, não do modelo: ela é identidade, e o modelo
      // inventaria uma diferente a cada destilação do mesmo documento.
      playbook: { ...generated.content, ...(input.key ? { key: input.key } : {}) },
      costMicros: generated.costMicros,
      totalTokens: generated.totalTokens,
    };
  }
}
