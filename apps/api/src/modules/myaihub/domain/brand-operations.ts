import { z } from 'zod';
import { brandMutationSchema } from '../../projects/domain/brand-mutations.js';
import type { MyAIHubOperation } from './operation.js';
import { intentField, describedField, narrativeField } from './output-intent.js';
import { BASE_POLICY_SECTIONS } from './policy-sections.js';

/**
 * Operação do OS sobre a identidade de marca (§4.4, Fase 5).
 *
 * Quinto `OperationTarget`, e o runner não abre exceção para ele tampouco. O
 * que é específico aqui: o documento NÃO TEM FACETAS — nada de lista de itens,
 * nada de `semanticKey`. Uma única mutação singleton, com merge campo a campo.
 */

export const brandOutputSchema = z.object({
  ...intentField,
  interpretedIntent: describedField(300),
  rationale: z.string().trim().min(3).max(2000),
  humanSummary: narrativeField(6000),
  // Teto 1: é um documento singleton. Uma lista de "mutações" aqui só poderia
  // ser a mesma mutação repetida, com a última vencendo em silêncio.
  mutations: z.array(brandMutationSchema).max(1),
  conflicts: z
    .array(z.object({ itemCode: z.string().max(10).optional(), description: z.string().max(400) }))
    .max(10)
    .default([]),
  gaps: z.array(z.string().max(300)).max(10).default([]),
});

/**
 * `project.refine_brand` — a identidade que o PÚBLICO vê.
 *
 * É a única configuração do sistema com efeito visual, e por isso a única em
 * que o usuário costuma chegar com um exemplo em vez de uma regra: "quero algo
 * mais sóbrio", "parecido com o site". A seção `examples` da policy é o que
 * impede isso de virar cópia literal — o que ele mostra é uma PROPRIEDADE.
 *
 * O tom de voz atravessa para o prompt do agente, e é por isso que esta
 * operação não é cosmética: mudar a marca para "descontraído" muda como todo
 * agente do projeto escreve, e a instrução manda dizer isso.
 */
export const REFINE_BRAND_IDENTITY: MyAIHubOperation = {
  name: 'project.refine_brand',
  // Ajusta o que existe: sem alvo o runner criaria um novo (ver requiresTarget).
  requiresTarget: true,
  outputContract: [
    '--- ANTES DE RESPONDER, CONFIRA ---',
    '',
    'Uma única mutação `SET_BRAND_IDENTITY`, com SOMENTE os campos que mudam.',
    'Campo que você não citar permanece como está — não repita o documento.',
    '',
    'Cor é hexadecimal de 6 dígitos com `#`. Nome de cor não é aceito.',
    '',
    'Fonte é só o NOME da família ("Inter", "Roboto Slab"), nunca uma URL nem uma',
    'pilha com vírgulas. Com `fontSource: "GOOGLE"` ela é carregada do Google',
    'Fonts; use `"SYSTEM"` para fonte de sistema (Arial, Helvetica) ou quando não',
    'souber — aí a página usa a pilha nativa em vez de baixar uma fonte errada.',
    '',
    '`successColor` e `dangerColor` marcam vantagem/desvantagem quando o chat',
    'mostra um comparativo — são a psicologia da cor DENTRO da marca, nunca o',
    'verde/vermelho genéricos de um sistema. Ajuste-os quando o usuário pedir',
    '("o verde de vantagem está muito parecido com o vermelho", "quero um verde',
    'mais discreto") — a escolha continua sendo dele, dentro da paleta que ele',
    'está construindo, nunca um tom que voce inventa sem pedido.',
    '',
  ].join('\n'),
  scope: 'PROJECT',
  label: 'Ajustando a identidade da marca',
  purpose:
    'Altera a IDENTIDADE VISUAL e o tom de voz da marca deste projeto: cor, logo, rodapé e como ela se apresenta.',
  targetType: 'PROJECT_BRAND_IDENTITY',
  steps: [
    { id: 'think', label: 'Lendo o negócio e a marca atual' },
    { id: 'persist', label: 'Salvando e versionando' },
  ],
  canonicalSchemaVersion: 1,
  allowedMutations: ['SET_BRAND_IDENTITY'],
  outputSchema: brandOutputSchema,
  policySections: [...BASE_POLICY_SECTIONS, 'brand_identity'],
  contextRequirements: [
    { key: 'project.brand_identity', priority: 90, cacheable: true, required: true },
  ],
  applyMode: 'USER_DIRECTED',
  modelRole: 'hub.reasoning',
  tokenBudget: 12_000,
  instruction: [
    'Você ajusta a IDENTIDADE DE MARCA do projeto: o que o público vê na página',
    'de atendimento antes de qualquer fala, e como o agente SOA quando fala.',
    '',
    'Só toque no que o usuário pediu. Devolver o documento inteiro faria você',
    'reescrever rodapé legal e orientação de voz que ninguém mencionou — e essa',
    'perda seria silenciosa.',
    '',
    'O TOM tem consequência de runtime: ele entra no prompt de TODO agente que',
    'atua neste projeto. Ao mudá-lo, diga isso na resposta — o usuário precisa',
    'saber que a mudança não é só visual, e que campanha publicada só recebe o',
    'ajuste na próxima publicação.',
    '',
    'Se ele colar um exemplo ("quero parecido com isto"), extraia a PROPRIEDADE —',
    'sobriedade, contraste, informalidade — e não o texto. Gravar o exemplo',
    'literal produz uma marca que repete a frase de outra pessoa.',
    '',
    'O perfil do projeto está no contexto. Use-o para a tagline dizer o que o',
    'negócio faz, em vez de uma frase que serviria para qualquer empresa.',
    '',
    'SITE NO CONTEXTO: quando houver um bloco "IDENTIDADE VISUAL MEDIDA NESTA',
    'PÁGINA", ele é a medição do site real — leia-o e vista a marca com ele.',
    'Como escolher, em ordem:',
    '- a cor de marca é a `theme-color` declarada; não havendo, a cor saturada',
    '  mais frequente em fundo/ícone. Cinza e preto quase nunca são a marca:',
    '  são a estrutura da página;',
    '- `canvas` e `surface` saem das cores de FUNDO mais frequentes (num site',
    '  claro elas são quase brancas; num escuro, quase pretas — respeite o que',
    '  o site é, não o que costuma ser);',
    '- `text` e `textMuted` saem das cores em TEXTO. O par precisa ser legível',
    '  sobre `surface`; não sendo, o domínio corrige e avisa;',
    '- a fonte é a que o site CARREGA de um provedor. Havendo uma para título e',
    '  outra para texto, declare as duas;',
    '- `shape` vem do raio de borda mais usado: até 4px é "SHARP", até 16px é',
    '  "SOFT", acima disso "ROUND".',
    '',
    'ISTO NÃO É ENFEITE: a página pública do atendimento se desenha inteira com',
    'estes campos. Quem chega nela veio de um anúncio daquela marca, e precisa',
    'reconhecê-la — não reconhecer o MyAIHub.',
  ].join('\n'),
};
