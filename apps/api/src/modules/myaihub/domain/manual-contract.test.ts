import {
  AGENT_FACET_MUTATION,
  AGENT_REMOVE_MUTATION,
  CAMPAIGN_FACET_MUTATION,
  CAMPAIGN_REMOVE_MUTATION,
  PROJECT_FACET_MUTATION,
  PROJECT_REMOVE_MUTATION,
} from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { agentMutationSchema } from '../../agents/domain/mutations.js';
import { campaignMutationSchema } from '../../campaigns/domain/mutations.js';
import { canonicalMutationSchema } from './mutations.js';

/**
 * O painel monta mutações a partir dos mapas do pacote compartilhado.
 *
 * Se um nome ali divergir do schema do domínio, a edição manual falha só em
 * runtime, com 422 e a tela dizendo que salvou. Este teste é o que garante que
 * os dois vocabulários são o MESMO.
 */
const CASES = [
  {
    nome: 'projeto',
    facetas: PROJECT_FACET_MUTATION,
    remove: PROJECT_REMOVE_MUTATION,
    schema: canonicalMutationSchema,
    faceta: 'audiences',
    prefixo: 'audience',
  },
  {
    nome: 'agente',
    facetas: AGENT_FACET_MUTATION,
    remove: AGENT_REMOVE_MUTATION,
    schema: agentMutationSchema,
    faceta: 'skills',
    prefixo: 'skill',
  },
  {
    nome: 'campanha',
    facetas: CAMPAIGN_FACET_MUTATION,
    remove: CAMPAIGN_REMOVE_MUTATION,
    schema: campaignMutationSchema,
    faceta: 'audience',
    prefixo: 'audience',
  },
] as const;

describe('contrato de mutação manual', () => {
  for (const caso of CASES) {
    it(`toda faceta de ${caso.nome} tem mutação aceita pelo schema`, () => {
      for (const kind of Object.values(caso.facetas)) {
        const result = caso.schema.safeParse({
          kind,
          semanticKey: `${caso.prefixo}.teste`,
          label: 'Teste',
          statement: 'Conteúdo do item.',
        });
        expect(result.success, `${caso.nome} → ${kind}`).toBe(true);
      }
    });

    it(`a remoção de ${caso.nome} é aceita pelo schema`, () => {
      const result = caso.schema.safeParse({
        kind: caso.remove,
        facet: caso.faceta,
        itemId: '01ITEM00000000000000000000',
        reason: 'O usuário removeu na tela.',
      });
      expect(result.success).toBe(true);
    });
  }
});
