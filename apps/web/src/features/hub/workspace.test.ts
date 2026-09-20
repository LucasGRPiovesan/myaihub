import { emptyAgent, emptyCampaign, emptyProjectProfile } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import type { QuickAction } from './contextual-actions';
import {
  agentWorkspace,
  campaignWorkspace,
  formatCost,
  prioritizeActions,
  projectWorkspace,
  rootWorkspace,
} from './workspace';

const ITEM = {
  id: '01',
  code: 'XX01',
  semanticKey: 'x.y',
  label: 'Item',
  statement: 'Conteúdo.',
  enforcement: 'SOFT' as const,
  source: 'USER' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('estado do projeto', () => {
  it('aponta público antes de campanha — fundação antes de acabamento', () => {
    const workspace = projectWorkspace({
      name: 'Sankar',
      versionNumber: 1,
      profile: emptyProjectProfile('Sankar'),
      campaignCount: 0,
      publishedCount: 0,
    });

    const ids = workspace.gaps.map((gap) => gap.id);
    expect(ids.indexOf('audience')).toBeLessThan(ids.indexOf('campaign'));
  });

  it('não cobra diferenciais de quem ainda não descreveu o que oferece', () => {
    const workspace = projectWorkspace({
      name: 'Sankar',
      versionNumber: 1,
      profile: emptyProjectProfile('Sankar'),
      campaignCount: 0,
      publishedCount: 0,
    });

    // Pedir diferencial antes de oferta é pedir na ordem errada.
    expect(workspace.gaps.map((gap) => gap.id)).not.toContain('differentiator');
  });

  it('para de apontar o que já está resolvido', () => {
    const profile = emptyProjectProfile('Sankar');
    profile.audiences = [{ ...ITEM, semanticKey: 'audience.a' }];
    profile.offerings = [{ ...ITEM, id: '02', semanticKey: 'offering.a' }];
    profile.differentiators = [{ ...ITEM, id: '03', semanticKey: 'differentiator.a' }];
    profile.businessRules = [{ ...ITEM, id: '04', semanticKey: 'business_rule.a' }];

    const workspace = projectWorkspace({
      name: 'Sankar',
      versionNumber: 2,
      profile,
      campaignCount: 1,
      publishedCount: 1,
    });

    expect(workspace.gaps).toHaveLength(0);
    expect(workspace.facts.find((fact) => fact.label === 'campanhas')?.value).toBe('1 · 1 no ar');
  });

  it('marca como vazio o que está zerado — é onde mora o próximo passo', () => {
    const workspace = projectWorkspace({
      name: 'Sankar',
      versionNumber: null,
      profile: null,
      campaignCount: 0,
      publishedCount: 0,
    });

    expect(workspace.facts.every((fact) => fact.empty)).toBe(true);
  });
});

describe('estado do agente', () => {
  it('cobra objetivo primeiro: sem ele o agente não sabe o que persegue', () => {
    const workspace = agentWorkspace({
      name: 'Philips',
      versionNumber: 1,
      config: emptyAgent('Philips'),
      campaignCount: 0,
    });

    expect(workspace.gaps[0]?.id).toBe('objective');
  });

  it('avisa quando o agente não fala com ninguém — e não oferece ação para isso', () => {
    const config = emptyAgent('Philips');
    config.objective.primary = 'Vender';
    config.communication = [{ ...ITEM, semanticKey: 'communication.a' }];
    config.hardRules = [{ ...ITEM, id: '02', semanticKey: 'hard_rule.a' }];

    const workspace = agentWorkspace({
      name: 'Philips',
      versionNumber: 3,
      config,
      campaignCount: 0,
    });

    const gap = workspace.gaps.find((item) => item.id === 'unused');
    expect(gap?.message).toContain('não está em nenhuma campanha');
    // Vincular é um clique na tela da campanha, não uma conversa com o modelo.
    expect(gap?.action).toBeUndefined();
  });
});

describe('estado da campanha', () => {
  it('marca como bloqueante o que impede publicar', () => {
    const workspace = campaignWorkspace({
      name: 'Captação',
      versionNumber: 1,
      strategy: emptyCampaign('Captação'),
      agentName: null,
      status: 'DRAFT',
      publishBlockers: ['A campanha ainda não tem objetivo definido.'],
    });

    const blocking = workspace.gaps.filter((gap) => gap.blocking).map((gap) => gap.id);
    expect(blocking).toContain('agent');
    expect(blocking).toContain('discovery');
  });

  it('não duplica o bloqueio de agente que o servidor também reporta', () => {
    const workspace = campaignWorkspace({
      name: 'Captação',
      versionNumber: 1,
      strategy: emptyCampaign('Captação'),
      agentName: null,
      status: 'DRAFT',
      publishBlockers: ['A campanha ainda não tem um agente vinculado.'],
    });

    const sobreAgente = workspace.gaps.filter((gap) => gap.message.includes('agente'));
    expect(sobreAgente).toHaveLength(1);
  });

  it('mostra o agente vinculado no subtítulo', () => {
    const workspace = campaignWorkspace({
      name: 'Captação',
      versionNumber: 2,
      strategy: emptyCampaign('Captação'),
      agentName: 'Philips',
      status: 'DRAFT',
      publishBlockers: [],
    });

    expect(workspace.subtitle).toBe('Philips · v2');
  });

  it('diz claramente quando não há agente', () => {
    const workspace = campaignWorkspace({
      name: 'Captação',
      versionNumber: null,
      strategy: null,
      agentName: null,
      status: 'DRAFT',
      publishBlockers: [],
    });

    expect(workspace.subtitle).toBe('sem agente vinculado');
  });
});

describe('estado da raiz', () => {
  it('manda começar pelo projeto quando a conta está vazia', () => {
    const workspace = rootWorkspace({ projectCount: 0, agentCount: 0 });
    expect(workspace.gaps[0]?.action?.operation).toBe('project.create_from_brief');
  });

  it('só sugere agente depois que existe projeto', () => {
    const workspace = rootWorkspace({ projectCount: 2, agentCount: 0 });
    expect(workspace.gaps[0]?.action?.operation).toBe('agent.create');
  });

  it('cala quando não há lacuna', () => {
    expect(rootWorkspace({ projectCount: 1, agentCount: 1 }).gaps).toHaveLength(0);
  });
});

describe('priorização das ações', () => {
  const fallback: QuickAction[] = [
    { id: 'refine-profile', label: 'Refinar', operation: 'project.refine_profile' },
    { id: 'create-campaign', label: 'Criar campanha', operation: 'campaign.create' },
  ];

  it('a ação que resolve lacuna vem antes da ação genérica', () => {
    const workspace = projectWorkspace({
      name: 'Sankar',
      versionNumber: 1,
      profile: emptyProjectProfile('Sankar'),
      campaignCount: 2,
      publishedCount: 0,
    });

    const actions = prioritizeActions(workspace, fallback);
    expect(actions[0]?.id).toBe('define-audience');
  });

  it('não repete a ação que já veio de uma lacuna', () => {
    const workspace = projectWorkspace({
      name: 'Sankar',
      versionNumber: 1,
      profile: emptyProjectProfile('Sankar'),
      campaignCount: 0,
      publishedCount: 0,
    });

    const actions = prioritizeActions(workspace, fallback);
    const campanhas = actions.filter((action) => action.id === 'create-campaign');
    expect(campanhas).toHaveLength(1);
  });

  it('preserva as ações do contexto quando não há lacuna', () => {
    const workspace = rootWorkspace({ projectCount: 1, agentCount: 1 });
    expect(prioritizeActions(workspace, fallback)).toEqual(fallback);
  });
});

describe('custo em linguagem humana', () => {
  it('usa quatro casas para valores minúsculos — arredondar viraria "US$ 0,00"', () => {
    expect(formatCost(300)).toBe('US$ 0.0003');
  });

  it('usa duas casas quando o valor é visível', () => {
    expect(formatCost(2_500_000)).toBe('US$ 2.50');
  });

  it('não inventa preço quando não houve custo', () => {
    expect(formatCost(0)).toBe('sem custo');
  });
});
