import { describe, expect, it, vi } from 'vitest';
import { PendingAdherence } from './pending-adherence.js';

/**
 * O veredito que chega DEPOIS da resposta.
 *
 * O auditor rodava serializado na frente do usuário e dobrava a espera na tela
 * por um dado acessório sobre uma resposta já produzida e já paga. Medido no
 * banco: mediana de ~1s do agente contra ~1,1s do auditor, e 8s a mais quando
 * ele travava — para no fim dizer "indisponível".
 */
describe('veredito pendente', () => {
  it('começa como CHECKING — é o que faz a tela continuar perguntando', () => {
    const pending = new PendingAdherence();
    pending.start('01TURNO000000000000000000');

    expect(pending.get('01TURNO000000000000000000')?.status).toBe('CHECKING');
  });

  it('turno desconhecido devolve null, e null NÃO é "sem violação"', () => {
    // Quem chama precisa distinguir "conferi e passou" de "não sei". Confundir
    // os dois foi o que já pintou o selo verde sobre um validador morto.
    const pending = new PendingAdherence();

    expect(pending.get('01NAOEXISTE0000000000000A')).toBeNull();
  });

  it('o veredito substitui o CHECKING', () => {
    const pending = new PendingAdherence();
    pending.start('01TURNO000000000000000000');
    pending.set('01TURNO000000000000000000', {
      status: 'CHECKED',
      violations: [{ check: 'no_promise', message: 'prometeu prazo' }],
    });

    const verdict = pending.get('01TURNO000000000000000000');
    expect(verdict?.status).toBe('CHECKED');
    expect(verdict?.violations).toHaveLength(1);
  });

  it('expira — o mapa não pode crescer para sempre num servidor de semanas', () => {
    vi.useFakeTimers();
    try {
      const pending = new PendingAdherence();
      pending.set('01TURNO000000000000000000', { status: 'CHECKED', violations: [] });

      vi.advanceTimersByTime(11 * 60 * 1000);

      expect(pending.get('01TURNO000000000000000000')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
