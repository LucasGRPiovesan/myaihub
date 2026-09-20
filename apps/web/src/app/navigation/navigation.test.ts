import { describe, expect, it } from 'vitest';
import { isItemActive, resolveNavLevel } from './navigation';

describe('nível do agente', () => {
  it('as facetas viram itens de navegação, como as seções do projeto', () => {
    const level = resolveNavLevel('/agentes/01AGT', { agentName: 'Alex' });

    expect(level.title).toBe('Alex');
    expect(level.back?.to).toBe('/agentes');

    const rotas = level.items.map((item) => item.to);
    expect(rotas).toContain('/agentes/01AGT/personalidade');
    expect(rotas).toContain('/agentes/01AGT/limites');
    // Sete facetas mais a visão geral.
    expect(rotas.length).toBe(8);
  });

  it('mostra quantos itens cada faceta tem', () => {
    const level = resolveNavLevel('/agentes/01AGT', {
      agentFacetCounts: { skills: 3, limits: 0 },
    });

    const skills = level.items.find((item) => item.to.endsWith('/skills'));
    const limites = level.items.find((item) => item.to.endsWith('/limites'));

    expect(skills?.badge).toBe(3);
    // Faceta sem contagem informada aparece como zero, não como ausente: o
    // usuário precisa ver que está vazia.
    expect(limites?.badge).toBe(0);
  });

  it('a faceta continua ativa dentro da própria rota', () => {
    const level = resolveNavLevel('/agentes/01AGT/skills');
    const skills = level.items.find((item) => item.to.endsWith('/skills'));

    expect(isItemActive(skills!, '/agentes/01AGT/skills')).toBe(true);
    // A visão geral usa `end`, então não fica ativa nas subrotas.
    const overview = level.items[0]!;
    expect(isItemActive(overview, '/agentes/01AGT/skills')).toBe(false);
  });

  it('lista as campanhas do agente depois das facetas', () => {
    const level = resolveNavLevel('/agentes/01AGT', {
      agentCampaigns: [{ id: '01CMP', name: 'Captação', projectId: '01PRJ' }],
    });

    expect(level.items.at(-1)?.to).toBe('/projetos/01PRJ/campanhas/01CMP');
    expect(level.items.at(-1)?.label).toBe('Captação');
  });
});

describe('resolveNavLevel', () => {
  it('usa o nível raiz na home', () => {
    const level = resolveNavLevel('/');
    expect(level.depth).toBe(0);
    expect(level.back).toBeUndefined();
    expect(level.items.map((item) => item.label)).toEqual([
      'Visão Geral',
      'Projetos',
      'Agentes',
      'Resultados',
    ]);
  });

  it('mantém a listagem de projetos na raiz — só um projeto específico empilha', () => {
    expect(resolveNavLevel('/projetos').depth).toBe(0);
    expect(resolveNavLevel('/agentes').depth).toBe(0);
  });

  it('empilha para o nível de projeto', () => {
    const level = resolveNavLevel('/projetos/prj_1', { projectName: 'Easy' });
    expect(level.depth).toBe(1);
    expect(level.id).toBe('project:prj_1');
    expect(level.title).toBe('Easy');
    expect(level.back).toEqual({ to: '/projetos', label: 'Projetos' });
    // As seis seções do perfil vêm logo depois da visão geral, como as
    // facetas do agente; campanhas e o Lab do projeto vêm depois delas.
    const rotas = level.items.map((item) => item.to);
    expect(rotas[1]).toBe('/projetos/prj_1/ofertas');
    expect(rotas).toContain('/projetos/prj_1/regras-de-negocio');
    expect(rotas).toContain('/projetos/prj_1/campanhas');
    expect(rotas).toContain('/projetos/prj_1/testar');
  });

  it('mantém o nível de projeto nas subrotas dele', () => {
    expect(resolveNavLevel('/projetos/prj_1/conhecimento').depth).toBe(1);
    expect(resolveNavLevel('/projetos/prj_1/campanhas').depth).toBe(1);
  });

  it('empilha para o nível de campanha e volta para o projeto', () => {
    const level = resolveNavLevel('/projetos/prj_1/campanhas/cmp_9/estrategia', {
      projectName: 'Easy',
      campaignName: 'Aquisição de prestadores',
    });

    expect(level.depth).toBe(2);
    expect(level.id).toBe('campaign:cmp_9');
    expect(level.title).toBe('Aquisição de prestadores');
    expect(level.back).toEqual({ to: '/projetos/prj_1', label: 'Easy' });
  });

  it('cai em títulos genéricos enquanto os nomes não carregaram', () => {
    expect(resolveNavLevel('/projetos/prj_1').title).toBe('Projeto');
    expect(resolveNavLevel('/projetos/prj_1/campanhas/cmp_9').title).toBe('Campanha');
  });

  it('produz ids estáveis por recurso — é o que a animação usa', () => {
    const a = resolveNavLevel('/projetos/prj_1');
    const b = resolveNavLevel('/projetos/prj_1/metricas');
    const other = resolveNavLevel('/projetos/prj_2');

    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(other.id);
  });
});

describe('isItemActive', () => {
  const overview = { to: '/projetos/prj_1', label: 'Visão Geral', icon: null as never, end: true };
  const campaigns = { to: '/projetos/prj_1/campanhas', label: 'Campanhas', icon: null as never };

  it('marca o item exato como ativo', () => {
    expect(isItemActive(overview, '/projetos/prj_1')).toBe(true);
  });

  it('não deixa a visão geral ativa em subrotas', () => {
    expect(isItemActive(overview, '/projetos/prj_1/campanhas')).toBe(false);
  });

  it('mantém o item ativo nas rotas abaixo dele', () => {
    expect(isItemActive(campaigns, '/projetos/prj_1/campanhas/cmp_9')).toBe(true);
    expect(isItemActive(campaigns, '/projetos/prj_1/campanhas')).toBe(true);
  });

  it('não confunde prefixo de string com hierarquia de rota', () => {
    expect(isItemActive(campaigns, '/projetos/prj_1/campanhas-arquivadas')).toBe(false);
  });
});
