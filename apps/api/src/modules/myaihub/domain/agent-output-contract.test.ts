import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toGeminiSchema } from '../../ai/infrastructure/providers/gemini-schema.js';
import { CONFIGURE_AGENT, CREATE_AGENT, createAgentOutputSchema } from './agent-operations.js';

const OPERATIONS = [CREATE_AGENT, CONFIGURE_AGENT];

function saida(mutations: unknown[]) {
  return {
    identity: { name: 'Arthur', role: 'Representante comercial' },
    objective: 'Qualificar quem chega pelo anúncio.',
    intent: 'CHANGE',
    interpretedIntent: 'Criar o agente comercial.',
    rationale: 'O usuário descreveu o papel.',
    humanSummary: 'Agente criado.',
    mutations,
  };
}

describe('contrato de saída do agente', () => {
  it('descarta mutação com kind inventado sem perder as demais', () => {
    const parsed = createAgentOutputSchema.safeParse(
      saida([
        {
          kind: 'UPSERT_SKILL',
          semanticKey: 'skills.diagnostico',
          label: 'Diagnostica',
          statement: 'Entende o problema antes de propor solução.',
        },
        { kind: 'UPSERT_PRINCIPLE', statement: 'inventado pelo modelo' },
        {
          kind: 'UPSERT_LIMIT',
          semanticKey: 'limits.promessa',
          label: 'Não promete',
          statement: 'Nunca promete resultado que não controla.',
        },
      ]),
    );

    expect(parsed.success).toBe(true);
    // O item errado sai; os dois bons ficam. Recusar a saída inteira custava um
    // turno de correção de dois minutos e terminava em erro para o usuário.
    expect(parsed.success && parsed.data.mutations).toHaveLength(2);
  });

  it('continua exigindo os campos obrigatórios das mutações que ficam', () => {
    const parsed = createAgentOutputSchema.safeParse(
      saida([{ kind: 'UPSERT_SKILL', label: 'sem semanticKey nem statement' }]),
    );

    // Tolerar kind inventado NÃO é afrouxar a validação do que sobra.
    expect(parsed.success).toBe(false);
  });

  it.each(OPERATIONS.map((op) => [op.name, op] as const))(
    '%s converte para JSON Schema com o vocabulário de kind completo',
    (_name, operation) => {
      // O contrato é convertido ANTES de qualquer chamada: se a conversão
      // lança, a operação morre em 0ms com "Falha ao chamar o provider" — sem
      // sequer tocar a rede. Foi o que um `.transform()` no schema causou.
      const json = z.toJSONSchema(operation.outputSchema as never, {
        io: 'input',
        target: 'draft-7',
        unrepresentable: 'any',
      });

      const adapted = toGeminiSchema(json) as {
        properties: { mutations: { items: { properties: { kind: { enum: string[] } } } } };
      };
      const kinds = adapted.properties.mutations.items.properties.kind.enum;

      expect(kinds).toContain('UPSERT_SKILL');
      expect(kinds).toContain('REMOVE_AGENT_ITEM');
    },
  );

  it('só o AJUSTE roteia instância contra arquétipo', () => {
    // Criar um agente não tem correção nenhuma para rotear: o usuário descreveu
    // um papel, não apontou comportamento errado. A seção ali era ~670 tokens
    // de deliberação disputando atenção com o contrato mais pesado do sistema,
    // e o sintoma foi o modelo inventando `kind` no meio de 30 mutações.
    expect(CONFIGURE_AGENT.policySections).toContain('calibration_level');
    expect(CREATE_AGENT.policySections).not.toContain('calibration_level');
    const shapeOf = (operation: typeof CREATE_AGENT) =>
      (operation.outputSchema as unknown as { shape: Record<string, unknown> }).shape;

    expect('craftSuggestion' in shapeOf(CONFIGURE_AGENT)).toBe(true);
    expect('craftSuggestion' in shapeOf(CREATE_AGENT)).toBe(false);
  });
});
