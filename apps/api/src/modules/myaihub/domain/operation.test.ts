import { HUB_SCOPES } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { MASTER_POLICY_V1 } from '../infrastructure/master-policy.seed.js';
import { listOperations } from './operation.js';
import { BASE_POLICY_SECTIONS } from './policy-sections.js';

describe('catálogo de operações do MyAIHub OS', () => {
  it('toda seção de policy declarada existe na Master Policy', () => {
    // O runner PULA em silêncio uma seção que não existe (`if (!content)
    // continue`). Sem este teste, declarar `campaign_strategy` numa operação e
    // esquecer de escrevê-la produziria um modelo sem orientação nenhuma — e
    // nada na execução acusaria.
    const known = new Set(Object.keys(MASTER_POLICY_V1));

    for (const operation of listOperations()) {
      for (const section of operation.policySections) {
        expect(known, `${operation.name} → ${section}`).toContain(section);
      }
    }
  });

  it('toda operação carrega a base de policy, sem exceção', () => {
    // Cada uma destas seções entrou no sistema porque a falta dela produziu um
    // bug visível para o usuário:
    //
    //   conversation       a pergunta virava alteração e o OS mexia no que
    //                      estava funcionando;
    //   diagnosis          "ele NEM está pedindo o nome" era lido como "não
    //                      peça o nome" — o OS apagava justamente o que o
    //                      usuário queria e respondia que tinha ajustado;
    //   examples           o exemplo de tom virava o texto final e o agente
    //                      repetia a mesma frase para todo mundo;
    //   information_level  o OS perguntava produto e preço ao criar um agente
    //                      que pertence à conta e atua em qualquer campanha.
    //
    // O runner pula seção ausente em SILÊNCIO, então nada acusaria a falta em
    // execução — só o usuário, meses depois, com o comportamento errado.
    for (const operation of listOperations()) {
      for (const section of BASE_POLICY_SECTIONS) {
        expect(operation.policySections, `${operation.name} → ${section}`).toContain(section);
      }
    }
  });

  it('toda operação sabe declarar que o turno foi só uma resposta', () => {
    // São três bases de saída independentes. Uma que esqueça o campo faria o
    // runner ler  como undefined, cair no caminho de alteração e gravar
    // configuração porque o usuário fez uma pergunta.
    for (const operation of listOperations()) {
      const parsed = operation.outputSchema.safeParse({
        interpretedIntent: 'pergunta sobre a configuração',
        rationale: 'o usuário perguntou, não pediu mudança',
        humanSummary: 'Hoje não.',
        intent: 'ANSWER',
        mutations: [],
        // A união de todas as identidades que as operações aceitam. O sujeito
        // deste teste é o `intent`, não a forma da identidade — e o Zod
        // descarta o que sobra em cada uma.
        identity: {
          name: 'x',
          role: 'y',
          type: 'z',
          summary: 'w',
          key: 'familia.especialidade',
          label: 'Rótulo do ofício',
          thesis: 'Uma tese de ofício com tamanho suficiente para o schema aceitar.',
          appliesTo: ['papel que este ofício reconhece'],
        },
        objective: 'qualquer',
      });

      expect(parsed.success, operation.name).toBe(true);
      expect((parsed as { data: { intent: string } }).data.intent).toBe('ANSWER');
    }
  });

  it('toda operação declara os passos que o painel vivo exibe', () => {
    // O runner usa o PRIMEIRO e o ÚLTIMO passo, por papel — não por índice.
    // Menos de dois deixaria "entender" e "salvar" no mesmo item, e o painel
    // ficaria parado durante a espera inteira.
    for (const operation of listOperations()) {
      expect(operation.steps.length, operation.name).toBeGreaterThanOrEqual(2);
      expect(new Set(operation.steps.map((step) => step.id)).size).toBe(operation.steps.length);
    }
  });

  it('toda mutação obrigatória está entre as permitidas', () => {
    // Exigir uma mutação que a própria operação proíbe é falha garantida em
    // 100% das execuções — e só apareceria na primeira vez que alguém usasse.
    for (const operation of listOperations()) {
      for (const required of operation.requiredMutations ?? []) {
        expect(operation.allowedMutations, `${operation.name} → ${required}`).toContain(required);
      }
    }
  });

  it('operação que cria filho declara o escopo do PAI', () => {
    // `scopeIdRole: 'PARENT'` só faz sentido em escopo que tem id. Em ROOT não
    // existe pai para receber o filho.
    for (const operation of listOperations()) {
      if (operation.scopeIdRole !== 'PARENT') continue;
      expect(operation.scope, operation.name).not.toBe('ROOT');
    }
  });
});

describe('escopo da operação', () => {
  it('cada operação declara um escopo que existe', () => {
    // O escopo é o que liga a rota do painel à operação. Um valor fora do
    // vocabulário faria a conversa nascer sem nenhuma operação disponível.
    for (const operation of listOperations()) {
      expect(HUB_SCOPES, operation.name).toContain(operation.scope);
    }
  });

  it('operações do MESMO escopo não colidem sem quick action', () => {
    // Quando há mais de uma no escopo, a UI precisa dizer qual — e diz. Este
    // teste existe para que acrescentar a segunda operação num escopo que só
    // tinha uma seja uma decisão consciente, não uma surpresa em produção.
    const byScope = new Map<string, string[]>();
    for (const operation of listOperations()) {
      byScope.set(operation.scope, [...(byScope.get(operation.scope) ?? []), operation.name]);
    }

    // DUAS no escopo PLAYBOOK desde que o OS passou a escrever o ofício que
    // falta, em vez de só registrar a lacuna e esperar um humano. A UI
    // desambigua: a listagem oferece "escrever um playbook", a tela de um
    // playbook oferece as ações de calibração.
    expect(byScope.get('PLAYBOOK')).toEqual(['playbook.create', 'playbook.refine']);
  });
});
