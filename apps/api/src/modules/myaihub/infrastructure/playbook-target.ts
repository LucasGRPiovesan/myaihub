import { PLACEHOLDER_PLAYBOOK_KEY, type AgentPlaybook } from '@myaihub/shared';
import type { AuditWriter } from '../../../shared/application/ports.js';
import { AppError } from '../../../shared/domain/errors.js';
import {
  elevateScope,
  runWithTenantContext,
  type TenantContext,
} from '../../../shared/application/tenant-context.js';
import type { ContextBlock } from '../../ai/domain/context.js';
import type {
  LoadedTarget,
  OperationTarget,
  PersistedTarget,
  PersistInput,
} from '../domain/operation-target.js';
import {
  applyPlaybookMutations,
  type PlaybookMutation,
  type PlaybookMutationKind,
} from '../domain/playbook-mutations.js';
import type { PlaybookRepository } from '../domain/repositories.js';

/**
 * O playbook como alvo de operação do OS.
 *
 * Quarta implementação da mesma porta, e a que prova que a abstração vale: o
 * runner não sabe que este agregado é de PLATAFORMA e não de conta, que não tem
 * lock otimista e que versiona em outra tabela. Ele só carrega, aplica mutação
 * tipada e manda persistir.
 *
 * O que muda aqui em relação aos outros três está todo confinado ao `persist`:
 * não há `ConfigurationChange` (que é registro de mudança DA CONTA) e a
 * auditoria carrega a chave do playbook, não um id de agregado do tenant.
 */
export class PlaybookTarget implements OperationTarget<
  AgentPlaybook,
  PlaybookMutation,
  PlaybookMutationKind
> {
  readonly entityType = 'PLAYBOOK';

  constructor(
    private readonly playbooks: PlaybookRepository,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * O que o OS precisa ver ALÉM do documento: a pauta e a evidência.
   *
   * Duas fontes, e nenhuma é decoração:
   *
   * A PAUTA são os papéis que chegaram sem ofício, por frequência. Sem ela, uma
   * criação de playbook seria um chute sobre o que vale escrever — e o sistema
   * já sabe a resposta, ele só não estava contando para o OS.
   *
   * As SUGESTÕES são as correções que o OS já aplicou em agentes daquele
   * ofício, uma a uma, em contas diferentes. Quando a mesma coisa aparece em
   * vários agentes, ela deixou de ser instância: é ofício faltando no piso. Era
   * o admin que tinha de perceber isso lendo a lista; agora o OS lê junto.
   *
   * Leitura CROSS-TENANT, e por isso passa por `elevateScope` com motivo — o
   * tenantGuard barraria, e estaria certo. Só o agregado atravessa: papel,
   * contagem e o texto que o OS mesmo escreveu. Nada de dado de negócio de
   * conta nenhuma.
   */
  async relatedContext(
    context: TenantContext,
    ids: { parentId: string | null; entityId: string | null },
  ): Promise<ContextBlock[]> {
    const blocos: ContextBlock[] = [];

    const elevado = elevateScope(
      context,
      context.accountId,
      'Playbook é de plataforma: a pauta e as sugestões são agregadas de todas as contas.',
    );

    return runWithTenantContext(elevado, async () => {
      // --- criando: a pauta diz o que vale escrever --------------------------
      if (!ids.entityId) {
        const pauta = await this.playbooks.listMisses(12);
        const existentes = await this.playbooks.listCurrent();

        blocos.push({
          id: 'playbook.agenda',
          kind: 'KNOWLEDGE',
          trust: 'TRUSTED',
          priority: 85,
          // Essencial: sem a pauta, esta operação vira invenção — e o sistema
          // já sabia a resposta.
          essential: true,
          cacheable: false,
          content: [
            pauta.length > 0
              ? 'PAPÉIS QUE CHEGARAM SEM OFÍCIO, por frequência — é esta a pauta:'
              : 'PAUTA VAZIA: nenhum papel chegou sem ofício até agora.',
            ...pauta.map(
              (linha) =>
                `  ${linha.count}× "${linha.role}" (último em ${linha.lastSeen.toISOString().slice(0, 10)})`,
            ),
            '',
            'OFÍCIOS QUE JÁ EXISTEM — não escreva um que se sobreponha a estes:',
            ...existentes.map(
              (playbook) =>
                `  ${playbook.key} — ${playbook.label}: ${playbook.appliesTo.join(' · ')}`,
            ),
          ].join('\n'),
        });

        return blocos;
      }

      // --- refinando: o que já foi corrigido nos agentes deste ofício --------
      const sugestoes = await this.playbooks.listSuggestions(ids.entityId, 15);
      if (sugestoes.length === 0) return blocos;

      // Agrupa por faceta: repetição na MESMA faceta é o sinal de que o piso
      // está incompleto ali, e é isso que o OS precisa enxergar de relance.
      const porFaceta = new Map<string, string[]>();
      for (const sugestao of sugestoes) {
        porFaceta.set(sugestao.facet, [
          ...(porFaceta.get(sugestao.facet) ?? []),
          sugestao.statement,
        ]);
      }

      blocos.push({
        id: 'playbook.field_evidence',
        kind: 'KNOWLEDGE',
        trust: 'TRUSTED',
        priority: 70,
        cacheable: false,
        content: [
          'O QUE JÁ FOI CORRIGIDO À MÃO EM AGENTES DESTE OFÍCIO.',
          '',
          'Cada linha é um ajuste que alguém precisou pedir porque o piso não',
          'cobria. Correção que se repete em contas diferentes não é instância:',
          'é ofício faltando aqui. Se você reconhecer um padrão, ESCREVA-O no',
          'playbook — é exatamente para isso que esta lista existe.',
          '',
          ...[...porFaceta.entries()].flatMap(([faceta, statements]) => [
            `${faceta} (${statements.length}):`,
            ...statements.map((statement) => `  - ${statement}`),
          ]),
        ].join('\n'),
      });

      return blocos;
    });
  }

  async load(
    _context: TenantContext,
    targetId: string,
  ): Promise<LoadedTarget<AgentPlaybook> | null> {
    const playbook = await this.playbooks.findByKey(targetId);
    if (!playbook) return null;

    const history = await this.playbooks.history(targetId);
    const current = history[0];

    return {
      entityId: playbook.key,
      canonical: playbook,
      versionId: null,
      versionNumber: current?.versionNumber ?? 1,
      // Sem lock otimista: o playbook é editado por um punhado de admins, não
      // por dois processos concorrentes. Inventar um lock aqui seria cerimônia.
      lockVersion: 0,
      displayName: playbook.label,
    };
  }

  /**
   * O ponto de partida de um ofício NOVO.
   *
   * Isto lançava — "playbook não nasce por operação do OS" — e a consequência
   * era o SO detectar a própria lacuna sem poder fechá-la: papel sem ofício
   * virava `PlaybookMiss`, o agente nascia genérico, e alguém teria de
   * escrever o playbook à mão algum dia.
   *
   * Registrar que falta e esperar um humano é o oposto do que este produto
   * promete. A curadoria continua existindo — o admin revisa, versiona e
   * corrige —, mas ela passa a revisar um rascunho REAL em vez de partir do
   * zero, e o agente do usuário para de nascer sem ofício enquanto isso.
   *
   * Os campos que só a operação sabe (chave, rótulo, tese) chegam por
   * mutação de identidade, como em todo agregado que nasce pelo OS.
   */
  empty(): AgentPlaybook {
    return {
      key: PLACEHOLDER_PLAYBOOK_KEY,
      label: 'Novo playbook',
      appliesTo: ['(a definir)'],
      thesis: 'Tese a definir pela operação que está criando este ofício.',
      principles: [],
      antiPatterns: [],
      alreadyAnswered: [],
      worthAsking: [],
      sources: [],
    };
  }

  facets(): readonly string[] {
    // Só as facetas cujos itens têm a forma canônica (`semanticKey`, `label`,
    // `statement`): é sobre ELAS que o guard de não-regressão sabe operar.
    //
    // `worthAsking` fica de fora de propósito. A pergunta tem `question` no
    // lugar de `statement`, e incluí-la fazia o guard ler `statement.length`
    // de `undefined` e derrubar a operação inteira — com a chamada ao modelo
    // já paga.
    return ['principles', 'antiPatterns'];
  }

  applyMutations(
    current: AgentPlaybook,
    mutations: PlaybookMutation[],
    mutationContext: { allowedMutations: readonly PlaybookMutationKind[] },
  ) {
    const result = applyPlaybookMutations(current, mutations, mutationContext.allowedMutations);
    return {
      canonical: result.playbook,
      applied: result.applied,
      rejected: result.rejected,
      adjustments: result.adjustments,
    };
  }

  summarize(playbook: AgentPlaybook): string[] {
    const byFacet = new Map<string, number>();
    for (const principle of playbook.principles) {
      byFacet.set(principle.facet, (byFacet.get(principle.facet) ?? 0) + 1);
    }

    return [
      playbook.thesis,
      `${playbook.principles.length} princípios · ${playbook.antiPatterns.length} limites · ${playbook.worthAsking.length} perguntas`,
      [...byFacet.entries()].map(([facet, count]) => `${facet} ${count}`).join(' · '),
    ];
  }

  contextBlock(playbook: AgentPlaybook): ContextBlock {
    return {
      id: 'playbook.current',
      kind: 'STABLE',
      trust: 'TRUSTED',
      priority: 88,
      cacheable: true,
      // Com CÓDIGO e CHAVE de cada item: sem elas o modelo não tem como pedir
      // "refine este" e acabaria criando um item novo dizendo a mesma coisa.
      content: [
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
        `JÁ RESPONDIDO PELO OFÍCIO: ${playbook.alreadyAnswered.join(' · ')}`,
        `FONTES: ${playbook.sources.join(' · ')}`,
      ].join('\n'),
    };
  }

  async persist(
    context: TenantContext,
    input: PersistInput<AgentPlaybook, PlaybookMutation>,
  ): Promise<PersistedTarget> {
    // Criação e refinamento pela MESMA porta: o que muda é existir ou não um
    // ofício com aquela chave. Dois caminhos de escrita produziriam dois
    // comportamentos para "salvar playbook", e o segundo nunca receberia as
    // correções do primeiro.
    const key = input.existing?.entityId ?? input.canonical.key;

    // Um ofício com a chave-MARCADOR é pior que um erro: ele entra no catálogo,
    // o classificador passa a oferecê-lo, e a criação seguinte sobrescreveria a
    // anterior — duas curadorias diferentes no mesmo endereço. Se chegou aqui
    // sem chave, o modelo não a escreveu: é falha de SAÍDA, não documento.
    if (key === PLACEHOLDER_PLAYBOOK_KEY) {
      throw new AppError(
        'STRUCTURED_OUTPUT_INVALID',
        'O ofício precisa de uma chave própria, como "reception.clinic". Tente de novo.',
        { httpStatus: 422 },
      );
    }

    const versionNumber = await this.playbooks.saveVersion(
      key,
      input.canonical,
      input.interpretedIntent.slice(0, 300),
    );

    // O playbook é global, mas quem mexeu pertence a uma conta — e é essa a
    // pergunta que a auditoria precisa responder depois: quem mudou o ofício
    // que todo mundo herdou.
    await this.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: input.existing ? 'PLAYBOOK_REFINED' : 'PLAYBOOK_CREATED',
      entityType: 'PLAYBOOK',
      entityId: key,
      metadata: {
        versionNumber,
        mutations: input.mutations.map((mutation) => mutation.kind),
        interpretedIntent: input.interpretedIntent,
      },
    });

    return {
      entityId: key,
      versionNumber,
      displayName: input.canonical.label,
    };
  }
}
