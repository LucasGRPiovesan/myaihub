import { HUB_SSE_EVENT, type HubEvent } from '@myaihub/shared';
import type { Request, Response } from 'express';
import type { EventBus } from '../shared/application/ports.js';

/** Sem isso, proxies e o Nginx bufferizam o SSE e o "tempo real" some. */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** Comentário SSE periódico: mantém a conexão viva através de proxies ociosos. */
const HEARTBEAT_MS = 25_000;

function serialize(event: HubEvent): string {
  // O `id:` é o que o browser reenvia em Last-Event-ID, e é o que torna o
  // replay possível depois de uma queda de conexão.
  return `id: ${event.seq}\nevent: ${HUB_SSE_EVENT}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface SseOptions {
  channel: string;
  bus: EventBus;
  /**
   * Eventos já ocorridos, entregues a ESTA conexão antes de acompanhar ao vivo.
   *
   * Vêm do banco, não do buffer em memória: a operação pode ter rodado antes
   * deste processo existir, ou o buffer já ter rotacionado. Publicá-los no bus
   * seria errado — iriam para os assinantes antigos, não para o que acabou de
   * chegar.
   */
  replay?: HubEvent[];
}

/**
 * Conecta um response HTTP a um canal do EventBus (§11).
 *
 * Reconexão: o browser manda `Last-Event-ID`, e reenviamos o que ele perdeu
 * antes de acompanhar ao vivo. Sem isso, um refresh no meio de uma operação
 * deixa a UI com um checklist congelado pela metade.
 */
export function openSseStream(request: Request, response: Response, options: SseOptions): void {
  response.writeHead(200, SSE_HEADERS);
  response.flushHeaders?.();

  const lastEventId = Number(request.header('last-event-id') ?? request.query['lastEventId'] ?? 0);
  const afterSeq = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

  const replayed = new Set<number>();

  for (const event of options.replay ?? []) {
    if (event.seq <= afterSeq) continue;
    replayed.add(event.seq);
    response.write(serialize(event));
  }

  for (const missed of options.bus.history(options.channel, afterSeq)) {
    // O buffer em memória e o replay do banco se sobrepõem; `seq` desempata
    // para o cliente não receber o mesmo evento duas vezes.
    if (replayed.has(missed.seq)) continue;
    replayed.add(missed.seq);
    response.write(serialize(missed));
  }

  const unsubscribe = options.bus.subscribe(options.channel, (event) => {
    if (replayed.has(event.seq)) return;
    response.write(serialize(event));
  });

  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  request.on('close', cleanup);
  response.on('close', cleanup);
}
