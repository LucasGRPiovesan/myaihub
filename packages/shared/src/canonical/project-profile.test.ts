import { describe, expect, it } from 'vitest';
import { assertMigrationChain, parseCanonical } from './migrate.js';
import {
  PROJECT_FACET_CODES,
  PROJECT_FACET_LABELS,
  PROJECT_FACET_MUTATION,
  PROJECT_FACET_SLUGS,
  PROJECT_PROFILE_SCHEMAS,
  PROJECT_SEMANTIC_KEY_PREFIXES,
  emptyProjectProfile,
  projectFacetFromSlug,
  type ProjectFacet,
} from './project-profile.js';

/**
 * A v2 acrescentou `market` e `businessRules`.
 *
 * Perfil gravado antes disso continua sendo lido — e é isso que a migração
 * existe para garantir. Sem ela, um perfil da v1 chegaria ao compilador do
 * prompt com as duas facetas `undefined`, e o agente quebraria numa conversa em
 * produção, não aqui.
 */
describe('migração do Project Profile', () => {
  it('a cadeia de migrações é contígua até a versão corrente', () => {
    expect(() => assertMigrationChain(PROJECT_PROFILE_SCHEMAS)).not.toThrow();
  });

  it('lê um perfil da v1 e devolve as facetas novas vazias', () => {
    const v1 = {
      canonicalSchemaVersion: 1,
      name: 'Sankar',
      type: 'empresa',
      summary: 'Indústria de molas.',
      business: {},
      audiences: [],
      offerings: [],
      valuePropositions: [],
      differentiators: [],
    };

    const perfil = parseCanonical(v1, PROJECT_PROFILE_SCHEMAS);

    expect(perfil.canonicalSchemaVersion).toBe(2);
    expect(perfil.market).toEqual([]);
    expect(perfil.businessRules).toEqual([]);
    // O que já existia sobrevive intacto: migração aditiva não reescreve nada.
    expect(perfil.summary).toBe('Indústria de molas.');
  });
});

/**
 * Os mapas por faceta precisam cobrir TODAS as facetas.
 *
 * São seis mapas paralelos — código, rótulo, prefixo semântico, mutação, slug,
 * descrição. Uma faceta nova que entre em cinco deles e falte no sexto produz
 * exatamente o sintoma que já apareceu aqui: a tela diz "salvo" e a API devolve
 * 422, ou o item some da sidebar sem nada acusar.
 */
describe('mapas por faceta', () => {
  const facetas = Object.keys(PROJECT_FACET_CODES) as ProjectFacet[];

  it('todo mapa cobre todas as facetas', () => {
    for (const mapa of [
      PROJECT_FACET_LABELS,
      PROJECT_SEMANTIC_KEY_PREFIXES,
      PROJECT_FACET_MUTATION,
      PROJECT_FACET_SLUGS,
    ]) {
      expect(Object.keys(mapa).sort()).toEqual([...facetas].sort());
    }
  });

  it('o documento vazio já tem todas as facetas', () => {
    const vazio = emptyProjectProfile('Novo');
    for (const faceta of facetas) expect(vazio[faceta]).toEqual([]);
  });

  it('o slug volta para a faceta, e slug inventado devolve null', () => {
    for (const faceta of facetas) {
      expect(projectFacetFromSlug(PROJECT_FACET_SLUGS[faceta])).toBe(faceta);
    }
    expect(projectFacetFromSlug('conhecimento')).toBeNull();
  });
});
