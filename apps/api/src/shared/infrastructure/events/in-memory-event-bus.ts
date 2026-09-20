import type { HubEvent } from '@myaihub/shared';
import type { EventBus } from '../../application/ports.js';

/**
 * EventBus dos eventos do painel vivo (§11).
 *
 * Port, com implementação in-memory. O MVP roda em instância única; quando
 * houver mais de uma, entra um adapter Redis aqui e NENHUM use case muda —
 * é por isso que a abstração existe agora, mesmo com uma implementação só.
 */

/** Eventos retidos por canal para o replay de reconexão. */
const MAX_HISTORY = 500;

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<(event: HubEvent) => void>>();
  private readonly buffers = new Map<string, HubEvent[]>();

  publish(channel: string, event: HubEvent): void {
    const buffer = this.buffers.get(channel) ?? [];
    buffer.push(event);
    // Descarta o começo: uma operação muito longa não pode virar vazamento de
    // memória enquanto ninguém está ouvindo.
    if (buffer.length > MAX_HISTORY) buffer.splice(0, buffer.length - MAX_HISTORY);
    this.buffers.set(channel, buffer);

    for (const listener of this.listeners.get(channel) ?? []) {
      // Um assinante que explode não pode derrubar os outros nem a operação.
      try {
        listener(event);
      } catch {
        // Silêncio deliberado: o SSE do assinante já vai fechar sozinho.
      }
    }
  }

  subscribe(channel: string, listener: (event: HubEvent) => void): () => void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);

    return () => {
      const current = this.listeners.get(channel);
      current?.delete(listener);
      if (current && current.size === 0) this.listeners.delete(channel);
    };
  }

  history(channel: string, afterSeq: number): HubEvent[] {
    return (this.buffers.get(channel) ?? []).filter((event) => event.seq > afterSeq);
  }

  close(channel: string): void {
    this.listeners.delete(channel);
    this.buffers.delete(channel);
  }
}
