import { Router } from 'express';
import { z } from 'zod';
import { publicChatRateLimit } from '../../../http/middlewares/rate-limit.js';
import { parseBody, parseParams } from '../../../http/validate.js';
import type { PublicChatUseCase } from '../application/public-chat.use-case.js';

export interface PublicChatRouterDependencies {
  publicChat: PublicChatUseCase;
}

const publicIdParamSchema = z.object({
  publicId: z.string().length(26, 'Endereço inválido.'),
});

const sessionParamSchema = publicIdParamSchema.extend({
  sessionId: z.string().length(26, 'Conversa inválida.'),
});

/**
 * O histórico NÃO vem mais do cliente (Fase 8).
 *
 * Vinha, e isso significava que o navegador de quem chegou pelo anúncio era a
 * fonte de verdade sobre o que o agente tinha respondido — além de a conversa
 * morrer num F5, no meio de um atendimento real. Agora ele manda o
 * `sessionId`, e o servidor lê do banco o que ele mesmo gravou.
 */
const inlineImageSchema = z.object({
  mimeType: z.string().trim().max(60),
  /** Base64 puro, sem o prefixo `data:`. Validado de verdade em `public-chat.use-case.ts`. */
  data: z.string().min(1),
});

const messageSchema = z
  .object({
    // Sem `min(1)`: uma foto sem legenda é o caso mais comum de anexo.
    message: z.string().trim().max(2000),
    sessionId: z.string().length(26).optional(),
    /** Efêmera: vira `LlmImagePart` deste turno e nunca é persistida. Só 1 aqui. */
    images: z.array(inlineImageSchema).max(1).default([]),
  })
  .refine((body) => body.message.length > 0 || body.images.length > 0, {
    message: 'Escreva alguma coisa ou anexe uma imagem.',
    path: ['message'],
  });

const openingSchema = z.object({
  sessionId: z.string().length(26).optional(),
});

/**
 * As rotas do Public Chat. SEM autenticação, e é isso que as torna especiais.
 *
 * Três defesas, e cada uma cobre uma coisa diferente:
 *
 * O `accountId` é DERIVADO do `publicId` dentro do use case, nunca aceito do
 * request — numa rota sem login, tenant vindo de fora seria a chave do
 * multi-tenant entregue a quem souber montar um POST.
 *
 * O limite de taxa é próprio e apertado: aqui um anônimo faz o sistema chamar
 * API paga, e sem teto um script vira fatura na conta de quem publicou.
 *
 * O histórico é do SERVIDOR, lido pelo `sessionId`. Enquanto vinha do cliente,
 * o custo de cada turno estava nas mãos dele — e a conversa não sobrevivia a um
 * recarregamento.
 */
export function createPublicChatRouter(deps: PublicChatRouterDependencies): Router {
  const router = Router();

  router.get('/public/:publicId', publicChatRateLimit, async (request, response) => {
    const { publicId } = parseParams(publicIdParamSchema, request);
    response.json(await deps.publicChat.view(publicId));
  });

  /** A primeira fala, quando a configuração publicada diz que ele abre. */
  router.post('/public/:publicId/opening', publicChatRateLimit, async (request, response) => {
    const { publicId } = parseParams(publicIdParamSchema, request);
    const body = parseBody(openingSchema, request);
    response.json(await deps.publicChat.open(publicId, body));
  });

  /**
   * O transcrito de uma conversa em andamento.
   *
   * É o que faz o F5 não apagar o atendimento: o navegador guarda o
   * `sessionId` e pede o resto aqui. Sem esta rota, persistir no servidor
   * resolveria só metade do problema — a conversa ficaria inteira no banco e a
   * tela voltaria vazia.
   */
  router.get(
    '/public/:publicId/sessions/:sessionId',
    publicChatRateLimit,
    async (request, response) => {
      const { publicId, sessionId } = parseParams(sessionParamSchema, request);
      response.json(await deps.publicChat.transcript(publicId, sessionId));
    },
  );

  router.post('/public/:publicId/messages', publicChatRateLimit, async (request, response) => {
    const { publicId } = parseParams(publicIdParamSchema, request);
    const body = parseBody(messageSchema, request);

    response.json(await deps.publicChat.reply(publicId, body));
  });

  return router;
}
