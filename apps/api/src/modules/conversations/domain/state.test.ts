import { emptyConversationState } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { deriveTurnEvents, mergeConversationState, objectiveJustReached } from './state.js';

const TURNO_BASE = {
  reply: 'Claro, posso ajudar.',
  violations: [],
  ctaUrl: null,
  hadVisitorMessage: true,
};

describe('eventos observados do turno', () => {
  it('registra a fala recebida e a enviada', () => {
    const eventos = deriveTurnEvents(TURNO_BASE);

    expect(eventos.map((evento) => evento.type)).toEqual(['MESSAGE_RECEIVED', 'MESSAGE_SENT']);
    expect(eventos.every((evento) => evento.source === 'OBSERVED')).toBe(true);
  });

  it('na abertura não houve fala do visitante', () => {
    const eventos = deriveTurnEvents({ ...TURNO_BASE, hadVisitorMessage: false });

    expect(eventos.map((evento) => evento.type)).toEqual(['MESSAGE_SENT']);
  });

  it('emite UM evento por violação, não um por turno', () => {
    const eventos = deriveTurnEvents({
      ...TURNO_BASE,
      violations: [
        { check: 'forbid_urls_outside', message: 'link externo' },
        { check: 'require_cta', message: 'sem CTA' },
      ],
    });

    const violacoes = eventos.filter((evento) => evento.type === 'RULE_VIOLATION');
    expect(violacoes).toHaveLength(2);
    // O dashboard agrega por CHECKER: sem o nome no payload, a tela não teria
    // como dizer QUAL regra está falhando.
    expect(violacoes[0]?.payload).toMatchObject({ check: 'forbid_urls_outside' });
  });

  it('o CTA só conta como oferecido quando o endereço aparece na resposta', () => {
    const semCta = deriveTurnEvents({ ...TURNO_BASE, ctaUrl: 'https://exemplo.com/orcamento' });
    expect(semCta.some((evento) => evento.type === 'CTA_OFFERED')).toBe(false);

    const comCta = deriveTurnEvents({
      ...TURNO_BASE,
      ctaUrl: 'https://exemplo.com/orcamento',
      reply: 'Peça aqui: https://exemplo.com/orcamento',
    });
    expect(comCta.some((evento) => evento.type === 'CTA_OFFERED')).toBe(true);
  });
});

describe('estado da conversa', () => {
  it('refina o fato pela chave em vez de duplicar', () => {
    const primeiro = mergeConversationState(null, {
      facts: [{ key: 'budget', value: 'até 5 mil' }],
      signals: [],
    });

    const segundo = mergeConversationState(primeiro, {
      facts: [{ key: 'budget', value: 'até 8 mil' }],
      signals: [],
    });

    expect(segundo.facts).toEqual([{ key: 'budget', value: 'até 8 mil' }]);
  });

  it('não repete o mesmo sinal', () => {
    const patch = {
      facts: [],
      signals: [{ kind: 'OBJECTION' as const, note: 'achou caro' }],
    };

    const depois = mergeConversationState(mergeConversationState(null, patch), patch);

    expect(depois.signals).toHaveLength(1);
  });

  it('o progresso NÃO retrocede por omissão', () => {
    const avancado = mergeConversationState(null, {
      facts: [],
      signals: [],
      progressPercent: 70,
    });

    // Turno em que o modelo não declarou nada não significa que a conversa
    // andou para trás.
    const seguinte = mergeConversationState(avancado, { facts: [], signals: [] });

    expect(seguinte.progress.percent).toBe(70);
  });

  it('objetivo alcançado não é desfeito por um turno silencioso', () => {
    const alcancado = mergeConversationState(null, {
      facts: [],
      signals: [],
      objectiveReached: true,
    });

    const seguinte = mergeConversationState(alcancado, { facts: [], signals: [] });

    expect(seguinte.progress.objectiveReached).toBe(true);
  });

  it('nunca sobrescreve o documento inteiro: o que já existia permanece', () => {
    const antes = mergeConversationState(null, {
      facts: [{ key: 'company', value: 'Metalúrgica X' }],
      signals: [{ kind: 'INTEREST' as const, note: 'pediu prazo' }],
    });

    const depois = mergeConversationState(antes, {
      facts: [{ key: 'role', value: 'comprador' }],
      signals: [],
    });

    expect(depois.facts).toHaveLength(2);
    expect(depois.signals).toHaveLength(1);
  });
});

describe('objetivo alcançado emite evento só na TRANSIÇÃO', () => {
  it('emite quando passa de não alcançado para alcançado', () => {
    const depois = mergeConversationState(null, {
      facts: [],
      signals: [],
      objectiveReached: true,
    });

    expect(objectiveJustReached(null, depois)).toBe(true);
  });

  it('não emite de novo nos turnos seguintes', () => {
    const alcancado = mergeConversationState(null, {
      facts: [],
      signals: [],
      objectiveReached: true,
    });
    const seguinte = mergeConversationState(alcancado, {
      facts: [],
      signals: [],
      objectiveReached: true,
    });

    // Redeclarar é o comportamento normal do modelo — o objetivo continua
    // alcançado. Emitir a cada vez inflaria a conversão de uma sessão em
    // quantos turnos ela tiver depois disso.
    expect(objectiveJustReached(alcancado, seguinte)).toBe(false);
  });

  it('estado vazio não tem objetivo alcançado', () => {
    expect(emptyConversationState().progress.objectiveReached).toBe(false);
  });
});
