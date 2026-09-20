import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../../../shared/domain/errors.js';
import type { LlmRequest } from '../../domain/provider.js';
import { FakeProvider } from './fake-provider.js';

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'fake-1',
    systemInstruction: 'você é um agente de teste',
    messages: [{ role: 'user', content: 'olá' }],
    params: {},
    ...overrides,
  };
}

describe('FakeProvider', () => {
  it('está sempre disponível — não depende de chave', () => {
    expect(new FakeProvider().available).toBe(true);
  });

  it('responde o roteiro configurado', async () => {
    const provider = new FakeProvider().script({ respond: 'resposta roteirizada' });
    const result = await provider.generate(request());

    expect(result.content).toBe('resposta roteirizada');
  });

  it('é determinístico — mesmo request, mesma resposta e mesmo uso', async () => {
    const provider = new FakeProvider().script({ respond: 'estável' });

    const first = await provider.generate(request());
    const second = await provider.generate(request());

    expect(first.content).toBe(second.content);
    expect(first.usage).toEqual(second.usage);
  });

  it('escolhe o roteiro pelo predicado', async () => {
    const provider = new FakeProvider()
      .script({ match: (req) => req.messages[0]?.content === 'a', respond: 'resposta A' })
      .script({ respond: 'resposta padrão' });

    const a = await provider.generate(request({ messages: [{ role: 'user', content: 'a' }] }));
    const b = await provider.generate(request({ messages: [{ role: 'user', content: 'b' }] }));

    expect(a.content).toBe('resposta A');
    expect(b.content).toBe('resposta padrão');
  });

  it('registra os requests para inspeção — é como o teste vê o que foi enviado', async () => {
    const provider = new FakeProvider();
    await provider.generate(request({ systemInstruction: 'instrução X' }));

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.systemInstruction).toBe('instrução X');
  });

  it('simula falha do provider', async () => {
    const provider = new FakeProvider().script({
      respond: '',
      fail: { code: 'PROVIDER_TIMEOUT', message: 'demorou demais' },
    });

    await expect(provider.generate(request())).rejects.toThrow(AppError);
  });

  it('reporta uso coerente com o conteúdo', async () => {
    const provider = new FakeProvider().script({ respond: 'x'.repeat(400) });
    const result = await provider.generate(request());

    expect(result.usage.outputTokens).toBe(100);
    expect(result.usage.totalTokens).toBe(result.usage.inputTokens + result.usage.outputTokens);
  });

  describe('stream', () => {
    it('entrega o texto em pedaços e fecha com o uso', async () => {
      const provider = new FakeProvider().script({ respond: 'abcdefghij' });

      const texts: string[] = [];
      let done = false;

      for await (const chunk of provider.stream(request())) {
        if (chunk.type === 'text') texts.push(chunk.text);
        if (chunk.type === 'done') done = true;
      }

      // Fatiado de verdade: um stream que entrega tudo de uma vez não exercita
      // o consumo incremental da UI.
      expect(texts.length).toBeGreaterThan(1);
      expect(texts.join('')).toBe('abcdefghij');
      expect(done).toBe(true);
    });
  });

  describe('generateStructured', () => {
    const schema = z.object({ intent: z.string(), confidence: z.number() });

    it('valida a saída contra o schema', async () => {
      const provider = new FakeProvider().script({
        respond: JSON.stringify({ intent: 'criar_projeto', confidence: 0.9 }),
      });

      const result = await provider.generateStructured(request(), schema);
      expect(result.content).toEqual({ intent: 'criar_projeto', confidence: 0.9 });
    });

    it('rejeita JSON que não bate com o schema', async () => {
      const provider = new FakeProvider().script({ respond: JSON.stringify({ intent: 'x' }) });

      await expect(provider.generateStructured(request(), schema)).rejects.toMatchObject({
        code: 'STRUCTURED_OUTPUT_INVALID',
      });
    });

    it('rejeita resposta que não é JSON', async () => {
      const provider = new FakeProvider().script({ respond: 'isso não é json' });

      await expect(provider.generateStructured(request(), schema)).rejects.toMatchObject({
        code: 'STRUCTURED_OUTPUT_INVALID',
      });
    });
  });
});
