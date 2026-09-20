import { describe, expect, it } from 'vitest';
import {
  isTransientProviderError,
  planRetry,
  EmptyResponseError,
  StalledError,
  CHAT_FIRST_TOKEN_TIMEOUT_MS,
  RETRY_FIRST_TOKEN_TIMEOUT_MS,
} from './gemini-provider.js';

const OVERLOADED = new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}');

describe('falha transitória do provider', () => {
  it('reconhece indisponibilidade e limite de taxa', () => {
    for (const message of [
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
      '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
      'got status: UNAVAILABLE',
    ]) {
      expect(isTransientProviderError(new Error(message)), message).toBe(true);
    }
  });

  it('NÃO repete erro de conteúdo — seria pagar para receber o mesmo não', () => {
    for (const message of [
      '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}',
      '{"error":{"code":403,"status":"PERMISSION_DENIED"}}',
      'API key not valid',
    ]) {
      expect(isTransientProviderError(new Error(message)), message).toBe(false);
    }
  });

  it('NÃO repete timeout: o pedido pode ter sido servido e cobrado', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(isTransientProviderError(timeout)).toBe(false);

    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    expect(isTransientProviderError(aborted)).toBe(false);
  });
});

describe('prazo da repetição', () => {
  it('repete enquanto o prazo comporta a repetição inteira', () => {
    expect(planRetry(OVERLOADED, 0, 30_000)).toBe(700);
    expect(planRetry(OVERLOADED, 1, 30_000)).toBe(2_200);
  });

  it('para na terceira tentativa, mesmo com prazo de sobra', () => {
    expect(planRetry(OVERLOADED, 2, 300_000)).toBeNull();
  });

  it('TRAVAMENTO repete uma vez só — sobrecarga repete duas', () => {
    // Medido: três travadas seguidas gastaram 126s antes de o usuário receber o
    // erro, e a terceira tentativa nunca salvou nenhuma. Um 503 é diferente: ali
    // o provider RESPONDEU dizendo que está ocupado — sinal de vida.
    const stalled = new StalledError(25_000);

    expect(planRetry(stalled, 0, 300_000)).toBe(700);
    expect(planRetry(stalled, 1, 300_000)).toBeNull();
  });

  it('NÃO repete quando o tempo restante não comporta a repetição', () => {
    // Foi o que produziu a falha de 55s: duas tentativas lentas repetidas sem
    // que ninguém perguntasse se ainda havia prazo. Repetir ali só faria o
    // usuário esperar o dobro pela MESMA mensagem de erro.
    expect(planRetry(OVERLOADED, 0, 3_000)).toBeNull();
    expect(planRetry(OVERLOADED, 1, 6_000)).toBeNull();
  });

  it('erro de conteúdo não repete, por mais tempo que sobre', () => {
    const invalid = new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT"}}');
    expect(planRetry(invalid, 0, 300_000)).toBeNull();
  });
});

/**
 * Resposta vazia é falha, não sucesso.
 *
 * Visto em produção num turno do Lab: 1,9s, 399 tokens de raciocínio, ZERO de
 * saída, gravado como SUCCESS. O agente "não respondeu" — que é o pior desfecho
 * possível para quem está justamente testando se ele responde.
 */
describe('resposta vazia', () => {
  it('repete UMA vez, como o travamento', () => {
    const error = new EmptyResponseError('STOP');

    expect(planRetry(error, 0, 60_000)).not.toBeNull();
    // Repetir duas vezes gastaria o dobro para receber o mesmo vazio: quem
    // devolveu nada tende a devolver nada de novo.
    expect(planRetry(error, 1, 60_000)).toBeNull();
  });

  it('não repete quando não cabe uma tentativa inteira no prazo', () => {
    // Falhar agora é melhor que falhar depois: a mensagem é a mesma e o usuário
    // recupera o turno mais cedo.
    expect(planRetry(new EmptyResponseError('STOP'), 0, 300)).toBeNull();
  });
});

/**
 * Travamento deixou de ser motivo para repetir — porque deixou de matar.
 *
 * No turno de conversa o pedido lento continua correndo enquanto um segundo
 * parte ao lado (`readRaced`). Quem chega primeiro ganha. O `planRetry` segue
 * valendo para o que o provider RECUSA — 503, 429 — e para a resposta vazia,
 * que são coisas que correr junto não resolve.
 */
describe('o que ainda repete', () => {
  it('sobrecarga repete duas vezes: o provider deu sinal de vida', () => {
    expect(planRetry(OVERLOADED, 0, 60_000)).not.toBeNull();
    expect(planRetry(OVERLOADED, 1, 60_000)).not.toBeNull();
  });

  it('erro de conteúdo não repete: seria pagar para receber o mesmo não', () => {
    expect(planRetry(new Error('INVALID_ARGUMENT: schema'), 0, 60_000)).toBeNull();
  });
});

/**
 * A COLEIRA DA REPETIÇÃO É LONGA; a da primeira tentativa é curta.
 *
 * As duas esperas não valem a mesma coisa. Abandonar a PRIMEIRA é barato — ela
 * não produziu token, logo não foi cobrada, e refazer custa só tempo.
 * Abandonar a SEGUNDA é caro: devolve erro depois de o usuário ter esperado
 * duas vezes, e o pedido seguinte é dele, à mão.
 *
 * Medido no banco com os dois valores iguais (8s): os turnos travados formavam
 * um agrupamento apertadíssimo em 9.577 · 9.637 · 9.725 · 9.783 · 9.812 ·
 * 10.059 ms — 8s de vigia mais ~1,5s da repetição, em quase metade dos turnos
 * com projeto e campanha carregados.
 */
describe('coleira assimétrica da primeira palavra', () => {
  it('a repetição espera mais que a primeira tentativa', () => {
    expect(RETRY_FIRST_TOKEN_TIMEOUT_MS).toBeGreaterThan(CHAT_FIRST_TOKEN_TIMEOUT_MS);
  });

  it('a primeira coleira fica ACIMA da cauda saudável medida', () => {
    // A distribuição medida da primeira palavra vai de 790ms a ~5.650ms antes
    // do grupo morto (14s+). Cortar abaixo disso mata pedido que ia responder,
    // e o refeito paga o prompt de novo para entregar a mesma coisa.
    expect(CHAT_FIRST_TOKEN_TIMEOUT_MS).toBeGreaterThan(5_650);
  });

  it('a primeira coleira fica ABAIXO do grupo morto', () => {
    // Passar de 14s seria esperar pela cauda que nunca chega — que é o que a
    // repetição existe para evitar.
    expect(CHAT_FIRST_TOKEN_TIMEOUT_MS).toBeLessThan(14_000);
  });

  it('o turno travado cabe no teto de conversa, com as duas coleiras', () => {
    // Se não coubesse, `planRetry` recusaria a repetição e o vigia curto viraria
    // apenas uma falha mais rápida — o oposto do que ele existe para fazer.
    const tetoDaConversa = 30_000;
    expect(CHAT_FIRST_TOKEN_TIMEOUT_MS + RETRY_FIRST_TOKEN_TIMEOUT_MS).toBeLessThanOrEqual(
      tetoDaConversa,
    );
  });
});
