import { describe, expect, it, vi } from 'vitest';
import { cooldownFor, GeminiKeyRing, msUntilPacificMidnight } from './gemini-keys.js';

const LIVRE = 'chave-gratuita';
const PAGA = 'chave-paga';

function anel(agora: Date, paga: string | null = PAGA) {
  const relogio = { valor: agora };
  const ring = new GeminiKeyRing(LIVRE, paga, { now: () => relogio.valor });
  return { ring, avanca: (ms: number) => (relogio.valor = new Date(relogio.valor.getTime() + ms)) };
}

/** 429 de cota diária, no formato que o SDK entrega na mensagem do erro. */
function erroDeCotaDiaria(retryDelay?: string): Error {
  return new Error(
    `429 RESOURCE_EXHAUSTED: You exceeded your current quota. ` +
      `"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"` +
      (retryDelay ? `, "retryDelay":"${retryDelay}"` : ''),
  );
}

describe('anel de chaves do Gemini', () => {
  it('usa a gratuita enquanto ela responde', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    expect(ring.select()).toEqual({ tier: 'FREE', apiKey: LIVRE });
  });

  it('troca para a paga quando a gratuita devolve 429', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));

    ring.reportExhausted('FREE', erroDeCotaDiaria());

    expect(ring.select()).toEqual({ tier: 'PAID', apiKey: PAGA });
  });

  it('a cota DIÁRIA só volta na virada do dia do Pacífico', () => {
    // 12:00Z = 05:00 em Los Angeles (PDT). Faltam 19h para a meia-noite de lá.
    const { ring, avanca } = anel(new Date('2026-09-05T12:00:00Z'));
    ring.reportExhausted('FREE', erroDeCotaDiaria());

    avanca(18 * 60 * 60 * 1000);
    expect(ring.select().tier).toBe('PAID');

    // Passada a virada (mais a margem), a PRÓXIMA chamada real tenta a
    // gratuita de novo — é essa a "verificação" que não custa nada.
    avanca(90 * 60 * 1000);
    expect(ring.select().tier).toBe('FREE');
  });

  it('obedece ao retryDelay quando o provider manda um', () => {
    const { ring, avanca } = anel(new Date('2026-09-05T12:00:00Z'));

    ring.reportExhausted('FREE', erroDeCotaDiaria('27s'));

    avanca(20_000);
    expect(ring.select().tier).toBe('PAID');
    avanca(10_000);
    expect(ring.select().tier).toBe('FREE');
  });

  it('nunca ENCURTA um bloqueio já marcado', () => {
    // Dois pedidos em voo devolvem 429 quase juntos; o segundo, com um
    // `retryDelay` curto, adiantaria a volta para antes do reset real.
    const { ring, avanca } = anel(new Date('2026-09-05T12:00:00Z'));

    ring.reportExhausted('FREE', erroDeCotaDiaria());
    ring.reportExhausted('FREE', erroDeCotaDiaria('5s'));

    avanca(60_000);
    expect(ring.select().tier).toBe('PAID');
  });

  it('a gratuita respondendo desfaz o bloqueio na hora', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    ring.reportExhausted('FREE', erroDeCotaDiaria());
    expect(ring.select().tier).toBe('PAID');

    ring.reportSuccess('FREE');

    expect(ring.select().tier).toBe('FREE');
  });

  it('429 na chave PAGA não tira a gratuita de circulação', () => {
    // Cota da paga é outro problema — teto de tier ou de gasto. Marcar a
    // gratuita aqui deixaria o sistema sem nenhuma das duas.
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));

    ring.reportExhausted('PAID', erroDeCotaDiaria());

    expect(ring.select().tier).toBe('FREE');
  });

  it('sem chave paga, segue na gratuita mesmo esgotada', () => {
    // Melhor tentar e receber o erro do provider que recusar em casa uma
    // chamada que talvez passasse: a cota pode ter voltado antes do previsto.
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'), null);

    ring.reportExhausted('FREE', erroDeCotaDiaria());

    expect(ring.select()).toEqual({ tier: 'FREE', apiKey: LIVRE });
  });

  it('erro por MINUTO espera um minuto, não um dia', () => {
    const agora = new Date('2026-09-05T12:00:00Z');
    const porMinuto = cooldownFor(
      new Error('429 RESOURCE_EXHAUSTED: quota exceeded for requests per minute'),
      agora,
    );

    expect(porMinuto).toBe(60_000);
    expect(cooldownFor(erroDeCotaDiaria(), agora)).toBeGreaterThan(60 * 60 * 1000);
  });
});

describe('força a chave paga — escolha do admin, não cota esgotada', () => {
  it('força a paga mesmo com a gratuita disponível e sem bloqueio', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    expect(ring.select().tier).toBe('FREE');

    ring.setForcedPaid(true);

    expect(ring.select()).toEqual({ tier: 'PAID', apiKey: PAGA });
  });

  it('desligar a força volta para automático — gratuita se ela estiver de pé', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    ring.setForcedPaid(true);

    ring.setForcedPaid(false);

    expect(ring.select()).toEqual({ tier: 'FREE', apiKey: LIVRE });
  });

  it('desligar a força não ressuscita a gratuita se ela seguir bloqueada de verdade', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    ring.reportExhausted('FREE', erroDeCotaDiaria());
    ring.setForcedPaid(true);

    ring.setForcedPaid(false);

    expect(ring.select().tier).toBe('PAID');
  });

  it('sem chave paga, forçar não muda nada — select() não tem para onde forçar', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'), null);

    ring.setForcedPaid(true);

    expect(ring.select()).toEqual({ tier: 'FREE', apiKey: LIVRE });
    expect(ring.status().forcedPaid).toBe(true);
  });

  it('status() reflete a escolha', () => {
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    expect(ring.status().forcedPaid).toBe(false);

    ring.setForcedPaid(true);

    expect(ring.status().forcedPaid).toBe(true);
  });

  it('avisa com o tier e o motivo certos ao ligar e desligar', () => {
    const avisos: Array<{ tier: string; until: Date | null; reason: string }> = [];
    const relogio = { valor: new Date('2026-09-05T12:00:00Z') };
    const ring = new GeminiKeyRing(LIVRE, PAGA, {
      now: () => relogio.valor,
      onSwitch: (notice) => avisos.push(notice),
    });

    ring.setForcedPaid(true);
    ring.setForcedPaid(false);

    expect(avisos).toEqual([
      { tier: 'PAID', until: null, reason: 'admin forçou a chave paga' },
      { tier: 'FREE', until: null, reason: 'admin voltou para automático' },
    ]);
  });

  it('chamar com o mesmo valor não dispara aviso de novo', () => {
    const avisos: unknown[] = [];
    const ring = new GeminiKeyRing(LIVRE, PAGA, { onSwitch: (notice) => avisos.push(notice) });

    ring.setForcedPaid(true);
    ring.setForcedPaid(true);

    expect(avisos).toHaveLength(1);
  });
});

describe('meia-noite do Pacífico', () => {
  it('conta pelo relógio de PAREDE de Los Angeles, com horário de verão', () => {
    // Setembro: PDT (UTC-7). 12:00Z = 05:00 local → faltam 19h.
    const verao = msUntilPacificMidnight(new Date('2026-09-05T12:00:00Z'));
    expect(Math.round(verao / 3_600_000)).toBe(19);

    // Janeiro: PST (UTC-8). 12:00Z = 04:00 local → faltam 20h.
    const inverno = msUntilPacificMidnight(new Date('2026-01-15T12:00:00Z'));
    expect(Math.round(inverno / 3_600_000)).toBe(20);
  });

  it('nunca devolve mais que um dia', () => {
    const valores = [0, 6, 12, 18, 23].map((hora) =>
      msUntilPacificMidnight(new Date(`2026-09-05T${String(hora).padStart(2, '0')}:00:00Z`)),
    );

    for (const valor of valores) {
      expect(valor).toBeGreaterThan(0);
      expect(valor).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });
});

describe('a chamada real é a sonda', () => {
  it('nenhuma requisição extra é feita para descobrir se a cota voltou', () => {
    // A garantia é estrutural: o anel não tem porta de saída para a rede.
    // Se um dia alguém acrescentar uma, este teste falha — e é para falhar.
    const { ring } = anel(new Date('2026-09-05T12:00:00Z'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    ring.reportExhausted('FREE', erroDeCotaDiaria());
    ring.select();
    ring.status();
    ring.reportSuccess('FREE');
    ring.select();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
