import { env } from '../config/env.js';
import { parseModelRoute } from '../modules/ai/application/model-router.js';
import { GeminiProvider } from '../modules/ai/infrastructure/providers/gemini-provider.js';

/**
 * Mede a latência do turno de conversa: TOTAL contra PRIMEIRO TOKEN.
 *
 * É a medição que decide se streaming resolve a espera. Se o tempo está na
 * fila do provider, o primeiro token demora igual e streaming não muda nada;
 * se está na geração, o primeiro token chega cedo e a espera percebida cai.
 */
const PROMPT = [
  'Você é Arthur, representante comercial da plataforma Easy, que conecta',
  'prestadores de serviço autônomos a clientes da região.',
  'Espelha o registro de quem fala com você. Uma ideia por mensagem.',
  'Diagnostica antes de propor: entende o problema antes de apresentar solução.',
].join('\n');

async function main(): Promise<void> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada.');

  const route = parseModelRoute(env.MODEL_ROLE_AGENT_RUNTIME);
  const provider = new GeminiProvider(env.GEMINI_API_KEY, {
    onRetry: (notice) => console.log(`  (repetiu: ${notice.reason.slice(0, 60)})`),
  });

  const request = {
    model: route.model,
    systemInstruction: PROMPT,
    messages: [{ role: 'user' as const, content: 'oi, vi o anúncio. como funciona?' }],
    params: { temperature: 0.6 },
  };

  for (let round = 1; round <= 4; round += 1) {
    const startedAt = Date.now();

    try {
      const result = await provider.generate(request);
      console.log(
        `${round}. completo  ${Date.now() - startedAt}ms · ${result.usage.outputTokens} tokens`,
      );
    } catch (error) {
      console.log(`${round}. completo  FALHOU em ${Date.now() - startedAt}ms`, String(error));
    }

    const streamStart = Date.now();
    let first = 0;
    let chunks = 0;

    try {
      for await (const chunk of provider.stream(request)) {
        if (chunk.type === 'text') {
          chunks += 1;
          if (!first) first = Date.now() - streamStart;
        }
      }
      console.log(
        `   stream    primeiro token em ${first}ms · total ${Date.now() - streamStart}ms · ${chunks} pedaços`,
      );
    } catch (error) {
      console.log(`   stream    FALHOU em ${Date.now() - streamStart}ms`, String(error));
    }
  }

  process.exit(0);
}

void main();
