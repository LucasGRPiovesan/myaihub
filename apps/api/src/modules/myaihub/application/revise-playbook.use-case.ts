import type { AgentPlaybook } from '@myaihub/shared';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { LlmGateway } from '../../ai/application/llm-gateway.js';
import {
  ALL_PLAYBOOK_MUTATIONS,
  applyPlaybookMutations,
  playbookMutationSchema,
  type PlaybookMutation,
} from '../domain/playbook-mutations.js';
import { MASTER_POLICY_NAME } from '../domain/policy.js';
import type { PolicyRepository } from '../domain/repositories.js';

/**
 * O OS calibra o playbook a pedido do admin — por MUTAÇÃO, nunca por reescrita.
 *
 * A primeira versão pedia o documento inteiro de volta e dependia de o modelo
 * copiar o resto palavra por palavra. Na medição contra o Gemini real ele
 * preservou 14 de 15 princípios — e é exatamente esse "14 de 15" que condena a
 * abordagem: um item se perdeu e ninguém teria como saber qual, num documento
 * que é o piso de todo agente daquele papel, em toda conta.
 *
 * Agora ele localiza o que precisa mudar e devolve só isso. Pode tocar várias
 * seções no mesmo pedido; o que ninguém citou não passa nem perto do modelo.
 *
 * Continua PROPONDO, não aplicando: o admin vê o que mudou e salva.
 */
const revisionSchema = z.object({
  /** O que você encontrou e o que fez, para o admin decidir sem reler tudo. */
  summary: z.string().trim().min(5).max(700),
  mutations: z.array(playbookMutationSchema).min(1).max(20),
});

export interface PlaybookRevision {
  playbook: AgentPlaybook;
  summary: string;
  applied: PlaybookMutation[];
  rejected: Array<{ kind: string; reason: string }>;
  adjustments: string[];
  costMicros: number;
  totalTokens: number;
}

const INSTRUCTION = [
  'Você é o MyAIHub OS calibrando um PLAYBOOK DE OFÍCIO a pedido do admin.',
  '',
  'O playbook é a baseline profissional de um papel: cada princípio vira um item',
  'na configuração de todo agente daquele tipo, na faceta declarada; cada limite',
  'vira uma proibição; cada pergunta é o que o sistema pergunta a quem cria o',
  'agente.',
  '',
  '========== VOCÊ NÃO REESCREVE O DOCUMENTO ==========',
  '',
  'Devolva APENAS as mutações necessárias. O que o pedido não menciona não entra',
  'na resposta e fica exatamente como está — é essa a garantia que o documento',
  'inteiro devolvido não conseguia dar.',
  '',
  'Mexer em mais de uma seção no mesmo pedido é normal e esperado: "ele insiste',
  'demais depois do não" costuma pedir um princípio mais forte E um limite.',
  '',
  '========== O VOCABULÁRIO ==========',
  '',
  '  SET_PLAYBOOK_IDENTITY   muda `label` e/ou `thesis`',
  '  UPSERT_PRINCIPLE        cria OU refina um princípio (`semanticKey`, `facet`,',
  '                          `label`, `statement`, `enforcement`)',
  '  REMOVE_PRINCIPLE        tira um princípio (`semanticKey`)',
  '  UPSERT_LIMIT            cria OU refina um limite',
  '  REMOVE_LIMIT            tira um limite',
  '  UPSERT_QUESTION         cria OU refina uma pergunta do briefing',
  '  REMOVE_QUESTION         tira uma pergunta',
  '  SET_RECOGNITION         substitui a lista de frases que reconhecem o papel',
  '  SET_ALREADY_ANSWERED    substitui a lista do que o ofício já responde',
  '  SET_SOURCES             substitui a lista de fontes',
  '',
  'REFINAR É REUTILIZAR A `semanticKey`. Para melhorar um princípio que já existe,',
  'mande UPSERT com a MESMA chave: o item é substituído no lugar, mantendo código',
  'e posição. Chave nova cria item novo — e dois itens dizendo a mesma coisa viram',
  'configuração contraditória no primeiro ajuste seguinte.',
  '',
  'As chaves e códigos atuais estão no documento abaixo. Use-os.',
  '',
  '========== COMO DECIDIR ==========',
  '',
  'ORIENTAÇÃO OU PROIBIÇÃO? É o campo `enforcement`, e ele muda o que chega ao',
  'agente. SOFT entra no meio da lista da faceta e o modelo pondera; HARD sobe',
  'para um bloco à parte, "REGRAS INEGOCIÁVEIS", lido antes de tudo. Um "é',
  'proibido" que nasce SOFT chega com o mesmo peso de "prefira" — e é assim que',
  'uma proibição correta não pega. Marque HARD o que for proibição; deixe em',
  'branco o que for ofício ponderável, e o que já estava marcado permanece.',
  '',
  '========== PROIBIÇÃO ABSTRATA NÃO É OBEDECIDA ==========',
  '',
  'Ela é INTERPRETADA. "Não tire conclusões precipitadas", "argumenta só com o',
  'que foi declarado" e "evita suposições" soam fortes e não dizem ao modelo o',
  'que não fazer: ele acredita que está cumprindo enquanto deduz. Isto não é',
  'teoria — foi medido neste playbook, com nove versões seguidas do mesmo',
  'princípio, cada uma reescrita com outras palavras, nenhuma efetiva.',
  '',
  'Uma proibição que funciona tem TRÊS partes:',
  '',
  '  1. a CLASSE do que é proibido, nomeada — não o caso que motivou o pedido;',
  '  2. o que fazer NO LUGAR, porque sem saída o modelo trava ou improvisa;',
  '  3. a forma concreta da saída, quando existe uma.',
  '',
  '  ruim  "Não deduz o modelo de operação do interlocutor."',
  '  bom   "Ocupação, cargo, empresa e o JEITO DE FALAR não revelam o vínculo:',
  '         gíria de trabalho diz o registro de quem fala, nunca o arranjo. É',
  '         proibido supor de onde vem o trabalho, quem são os clientes, se ela',
  '         mesma vende ou capta. E perguntar não autoriza supor: "como chegam',
  '         os SEUS clientes?" já afirma que ela os tem. Quando a fala couber',
  '         em mais de uma leitura, pergunte OFERECENDO AS DUAS."',
  '',
  'A versão boa não cita profissão, ramo nem caso — e por isso serve a qualquer',
  'agente daquele papel. A ruim serve de lembrete para quem já sabia.',
  '',
  'RELATO DE FALHA NÃO É PEDIDO DE REMOÇÃO. "Ele insiste demais depois do não" é',
  'queixa de que o comportamento falhou: o princípio existe e está fraco ou vago.',
  'Reescreva-o mais explícito (UPSERT com a mesma chave) e, se couber, promova a',
  'limite. REMOVE só quando o admin pedir para tirar.',
  '',
  'REFINAR É AUMENTAR PRECISÃO, NÃO ENCURTAR. O `statement` novo precisa ser mais',
  'específico que o anterior. Trocar instrução detalhada por adjetivo é regressão,',
  'mesmo parecendo mais limpo.',
  '',
  'Cada `statement` é INSTRUÇÃO acionável em terceira pessoa, com o motivo',
  'embutido quando ele muda o comportamento — nunca um rótulo. "Seja consultivo"',
  'não configura nada; "investiga a situação e as implicações do problema antes de',
  'apresentar qualquer solução" configura.',
  '',
  'A FACETA define em que parte da configuração o item nasce: personalidade é como',
  'o agente É; comunicação é como ele SE COMUNICA; skill é o que SABE FAZER;',
  'comportamento é como AGE; estratégia é abordagem disponível; regra dura é',
  'obrigação inegociável.',
  '',
  'Pergunta só entra se for FATO que apenas quem opera o negócio sabe E que',
  'continue valendo em qualquer campanha. Produto, preço, público e desconto são',
  'da campanha e nunca cabem aqui.',
  '',
  '--- ANTES DE RESPONDER, CONFIRA ---',
  '',
  'Toda mutação que você mandou responde a algo que o admin PEDIU? Item que ele',
  'não mencionou não deveria aparecer na sua resposta. Ao refinar, você reutilizou',
  'a `semanticKey` que já existe? O `summary` diz o que você encontrou e o que',
  'fez, e não apenas "atualizei o playbook"?',
].join('\n');

/** O documento como o modelo precisa vê-lo: com as chaves que ele vai citar. */
function describeForPrompt(playbook: AgentPlaybook): string {
  const lines = [
    `PLAYBOOK ATUAL — ${playbook.label} (${playbook.key})`,
    '',
    `TESE: ${playbook.thesis}`,
    '',
    'PRINCÍPIOS:',
    ...playbook.principles.map(
      (item) =>
        `  [${item.code}] ${item.semanticKey} · ${item.facet} · ${item.label}\n      ${item.statement}`,
    ),
    '',
    'LIMITES:',
    ...playbook.antiPatterns.map(
      (item) => `  [${item.code}] ${item.semanticKey} · ${item.label}\n      ${item.statement}`,
    ),
    '',
    'PERGUNTAS DO BRIEFING:',
    ...playbook.worthAsking.map(
      (item) => `  [${item.code}] ${item.semanticKey} · ${item.question} (${item.why})`,
    ),
    '',
    `RECONHECIDO POR: ${playbook.appliesTo.join(' · ')}`,
    `JÁ RESPONDIDO: ${playbook.alreadyAnswered.join(' · ')}`,
    `FONTES: ${playbook.sources.join(' · ')}`,
  ];

  return lines.join('\n');
}

export class RevisePlaybookUseCase {
  constructor(private readonly deps: { gateway: LlmGateway; policies: PolicyRepository }) {}

  async execute(
    context: TenantContext,
    input: { playbook: AgentPlaybook; instruction: string },
  ): Promise<PlaybookRevision> {
    const policy = await this.deps.policies.getCurrent(MASTER_POLICY_NAME);
    const sections = ['diagnosis', 'agent_taxonomy'];

    const generated = await this.deps.gateway.generateStructured(
      context,
      {
        role: 'hub.reasoning',
        blocks: [
          ...sections.flatMap((section, index) => {
            const content = policy?.sections[section];
            if (!content) return [];
            return [
              {
                id: `policy.${section}`,
                kind: 'POLICY' as const,
                trust: 'TRUSTED' as const,
                priority: 100 - index,
                cacheable: true,
                content,
              },
            ];
          }),
          {
            id: 'revise.instruction',
            kind: 'POLICY' as const,
            trust: 'TRUSTED' as const,
            priority: 95,
            cacheable: true,
            content: INSTRUCTION,
          },
          {
            id: 'revise.current',
            kind: 'STABLE' as const,
            trust: 'TRUSTED' as const,
            priority: 85,
            cacheable: true,
            content: describeForPrompt(input.playbook),
          },
        ],
        messages: [{ role: 'user', content: input.instruction }],
        params: { temperature: 0.3 },
        tokenBudget: 40_000,
        ...(policy ? { policyVersionId: policy.id } : {}),
        policySections: sections,
      },
      revisionSchema,
    );

    // O domínio aplica; o modelo só propôs. Chave e itens não citados são
    // preservados por CÓDIGO, não por disciplina do modelo.
    const result = applyPlaybookMutations(
      input.playbook,
      generated.content.mutations,
      ALL_PLAYBOOK_MUTATIONS,
    );

    return {
      playbook: result.playbook,
      summary: generated.content.summary,
      applied: result.applied,
      rejected: result.rejected,
      adjustments: result.adjustments,
      costMicros: generated.costMicros,
      totalTokens: generated.totalTokens,
    };
  }
}
