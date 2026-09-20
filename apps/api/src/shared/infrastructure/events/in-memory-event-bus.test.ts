import type { HubEvent } from '@myaihub/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from './in-memory-event-bus.js';

function delta(seq: number, text = 'x'): HubEvent {
  return { type: 'message.delta', seq, operationId: 'op-1', text };
}

describe('InMemoryEventBus', () => {
  it('entrega eventos aos assinantes do canal', () => {
    const bus = new InMemoryEventBus();
    const received: HubEvent[] = [];

    bus.subscribe('op-1', (event) => received.push(event));
    bus.publish('op-1', delta(1));

    expect(received).toHaveLength(1);
  });

  it('isola canais entre si', () => {
    const bus = new InMemoryEventBus();
    const received: HubEvent[] = [];

    bus.subscribe('op-1', (event) => received.push(event));
    bus.publish('op-2', delta(1));

    expect(received).toEqual([]);
  });

  it('para de entregar depois do unsubscribe', () => {
    const bus = new InMemoryEventBus();
    const received: HubEvent[] = [];

    const unsubscribe = bus.subscribe('op-1', (event) => received.push(event));
    bus.publish('op-1', delta(1));
    unsubscribe();
    bus.publish('op-1', delta(2));

    expect(received).toHaveLength(1);
  });

  it('um assinante que lança não derruba os outros', () => {
    // Um SSE que já caiu não pode abortar a operação nem os demais ouvintes.
    const bus = new InMemoryEventBus();
    const received: HubEvent[] = [];

    bus.subscribe('op-1', () => {
      throw new Error('assinante quebrado');
    });
    bus.subscribe('op-1', (event) => received.push(event));

    expect(() => bus.publish('op-1', delta(1))).not.toThrow();
    expect(received).toHaveLength(1);
  });

  describe('replay', () => {
    it('devolve os eventos posteriores ao seq informado', () => {
      const bus = new InMemoryEventBus();
      bus.publish('op-1', delta(1, 'a'));
      bus.publish('op-1', delta(2, 'b'));
      bus.publish('op-1', delta(3, 'c'));

      const missed = bus.history('op-1', 1);
      expect(missed.map((event) => event.seq)).toEqual([2, 3]);
    });

    it('devolve tudo quando não houve nada recebido antes', () => {
      const bus = new InMemoryEventBus();
      bus.publish('op-1', delta(1));
      expect(bus.history('op-1', 0)).toHaveLength(1);
    });

    it('guarda histórico mesmo sem nenhum assinante conectado', () => {
      // É o cenário real: a operação começa antes do browser abrir o SSE.
      const bus = new InMemoryEventBus();
      bus.publish('op-1', delta(1));

      expect(bus.history('op-1', 0)).toHaveLength(1);
    });

    it('limita o histórico para uma operação longa não virar vazamento', () => {
      const bus = new InMemoryEventBus();
      for (let seq = 1; seq <= 600; seq += 1) bus.publish('op-1', delta(seq));

      const history = bus.history('op-1', 0);
      expect(history.length).toBeLessThanOrEqual(500);
      // Descarta o começo, mantém o fim: o que importa é o estado recente.
      expect(history.at(-1)?.seq).toBe(600);
    });
  });

  it('close limpa assinantes e histórico do canal', () => {
    const bus = new InMemoryEventBus();
    bus.subscribe('op-1', () => {});
    bus.publish('op-1', delta(1));

    bus.close('op-1');

    expect(bus.history('op-1', 0)).toEqual([]);
  });
});
