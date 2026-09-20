import { describe, expect, it } from 'vitest';
import { resolveHubContext, type ContextualActionInput } from './contextual-actions';

const base: ContextualActionInput = {
  pathname: '/',
  firstName: 'Lucas',
  hasProjects: true,
};

describe('resolveHubContext', () => {
  it('convida a criar o primeiro projeto quando a conta está vazia', () => {
    const context = resolveHubContext({ ...base, hasProjects: false });

    expect(context.scope).toBe('ROOT');
    expect(context.subtitle).toBe('Vamos criar seu primeiro projeto?');
    expect(context.actions).toHaveLength(1);
    expect(context.actions[0]?.operation).toBe('project.create_from_brief');
  });

  it('saúda pelo nome quando já existem projetos', () => {
    expect(resolveHubContext(base).greeting).toBe('Olá, Lucas');
  });

  it('reconhece o escopo de projeto', () => {
    const context = resolveHubContext({ ...base, pathname: '/projetos/prj_1/conhecimento' });
    expect(context.scope).toBe('PROJECT');
    expect(context.actions.map((action) => action.operation)).toEqual([
      'project.refine_profile',
      'project.refine_profile',
      'project.organize_workspace',
      'campaign.create',
    ]);
    // O id do escopo sai da MESMA função que decidiu o escopo.
    expect(context.scopeId).toBe('prj_1');
  });

  it('a tela da identidade tem ações PRÓPRIAS, não as do perfil', () => {
    // Escopo é o mesmo (PROJECT), mas a ação não pode ser: oferecer
    // "informar sobre o negócio" aqui é o mesmo tipo de ação fora de lugar
    // que já disparou a operação errada com o id certo de outra coisa.
    const context = resolveHubContext({ ...base, pathname: '/projetos/prj_1/identidade' });

    expect(context.scope).toBe('PROJECT');
    expect(context.scopeId).toBe('prj_1');
    expect(context.actions.every((action) => action.operation === 'project.refine_brand')).toBe(
      true,
    );
  });

  it('oferece criação de agente na listagem de agentes', () => {
    const context = resolveHubContext({ ...base, pathname: '/agentes' });
    expect(context.scope).toBe('ROOT');
    expect(context.actions[0]?.operation).toBe('agent.create');
  });

  it('toda ação aponta para uma operação que existe no backend', () => {
    const known = new Set([
      'project.create_from_brief',
      'project.refine_profile',
      'project.organize_workspace',
      'project.refine_brand',
      'playbook.create',
      'playbook.refine',
      'agent.create',
      'agent.configure',
      'campaign.create',
      'campaign.refine_strategy',
      'campaign.configure_cta',
    ]);

    const paths = [
      '/',
      '/projetos',
      '/projetos/p',
      '/projetos/p/identidade',
      '/admin/playbooks',
      '/admin/playbooks/sales.consultive',
      '/projetos/p/campanhas',
      '/projetos/p/campanhas/c',
      '/agentes',
      '/agentes/a',
    ];

    for (const pathname of paths) {
      for (const hasProjects of [true, false]) {
        for (const action of resolveHubContext({ ...base, pathname, hasProjects }).actions) {
          expect(known, `${pathname} → ${action.operation}`).toContain(action.operation);
        }
      }
    }
  });

  it('reconhece o escopo de agente', () => {
    const context = resolveHubContext({ ...base, pathname: '/agentes/agt_1' });
    expect(context.scope).toBe('AGENT');
  });

  it('mantém a listagem de agentes na raiz', () => {
    expect(resolveHubContext({ ...base, pathname: '/agentes' }).scope).toBe('ROOT');
  });

  it('prioriza campanha sobre projeto quando a rota é aninhada', () => {
    const context = resolveHubContext({
      ...base,
      pathname: '/projetos/prj_1/campanhas/cmp_9/estrategia',
    });

    expect(context.scope).toBe('CAMPAIGN');
    // O escopo é da CAMPANHA, então o id também precisa ser: mandar o id do
    // projeto junto de scope CAMPAIGN faria o OS carregar o contexto errado.
    expect(context.scopeId).toBe('cmp_9');
    expect(context.actions.map((action) => action.id)).toEqual([
      'audience',
      'discovery',
      'rule',
      'cta',
    ]);
  });

  it('a listagem de campanhas é escopo de PROJETO — a campanha ainda não existe', () => {
    const context = resolveHubContext({ ...base, pathname: '/projetos/prj_1/campanhas' });

    expect(context.scope).toBe('PROJECT');
    expect(context.scopeId).toBe('prj_1');
    expect(context.actions[0]?.operation).toBe('campaign.create');
  });

  it('sempre devolve ao menos uma ação — o painel nunca fica sem saída', () => {
    for (const pathname of [
      '/',
      '/projetos',
      '/agentes',
      '/projetos/p/campanhas',
      '/projetos/p/campanhas/c',
    ]) {
      expect(resolveHubContext({ ...base, pathname }).actions.length).toBeGreaterThan(0);
    }
  });

  it('usa ids únicos dentro de cada contexto', () => {
    for (const pathname of ['/', '/projetos/p', '/agentes/a', '/projetos/p/campanhas/c']) {
      const ids = resolveHubContext({ ...base, pathname }).actions.map((action) => action.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
