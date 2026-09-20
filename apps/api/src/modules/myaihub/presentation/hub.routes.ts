import {
  sendHubMessageSchema,
  startHubConversationSchema,
  type HubAttachmentView,
  type HubConversationView,
  type HubOperationView,
} from '@myaihub/shared';
import { Router } from 'express';
import { rootPinoLogger } from '../../../shared/infrastructure/logging/pino-logger.js';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { openSseStream } from '../../../http/sse.js';
import { parseBody, parseParams } from '../../../http/validate.js';
import type { EventBus, IdGenerator, TokenService } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';

import { operationChannel, type MyAIHubOperationRunner } from '../application/operation-runner.js';
import { getOperation } from '../domain/operation.js';
import type { RouteHubRequestUseCase } from '../application/route-request.use-case.js';
import type { HubConversationRepository, HubOperationRepository } from '../domain/repositories.js';

export interface HubRouterDependencies {
  tokens: TokenService;
  conversations: HubConversationRepository;
  operations: HubOperationRepository;
  runner: MyAIHubOperationRunner;
  /**
   * Quem escolhe a operação quando existe mais de uma possível.
   *
   * A escolha era do CHIP da tela, e o chip errava — ver a nota em
   * `route-request.use-case.ts`. Ela vive aqui e não dentro do runner porque
   * decide QUAL operação registrar: o registro persistido, o rótulo do painel e
   * os eventos precisam nascer já com a operação certa.
   */
  router: RouteHubRequestUseCase;
  bus: EventBus;
  ids: IdGenerator;
  /**
   * Resolve ids de anexo em views.
   *
   * Função, e não o repositório de mídia inteiro: esta rota não precisa saber
   * ler arquivo — precisa saber montar o transcrito.
   */
  attachments: (context: TenantContext, ids: string[]) => Promise<HubAttachmentView[]>;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

/**
 * VALIDA o nome de operação que o cliente pediu. Só isso.
 *
 * Duas responsabilidades saíram daqui, e as duas foram para lugares melhores.
 *
 * ESCOLHER virou trabalho do `RouteHubRequestUseCase`: devolver um 422
 * "informe qual operação executar" era passar a ambiguidade ao cliente, e quem
 * sabe o que o usuário quer é o que ele ESCREVEU.
 *
 * A checagem de ESCOPO saiu porque era a cerca. Ela existia contra um risco
 * real — cliente com estado velho disparando a operação de uma tela com o id de
 * outra —, mas resolvia isso proibindo o S.O de agir fora da tela, que é
 * exatamente a limitação que este produto não pode ter. A proteção equivalente
 * agora confere o ALVO contra o inventário da conta, por tipo: id inventado não
 * está lá, e id do tipo errado está na lista errada.
 */
function resolveOperation(_scope: string, requested?: string) {
  if (!requested) return undefined;

  const operation = getOperation(requested);
  if (!operation) {
    throw new AppError('VALIDATION_ERROR', `Operação desconhecida: "${requested}".`, {
      httpStatus: 422,
    });
  }

  return operation;
}

export function createHubRouter(deps: HubRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.post('/hub/conversations', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const input = parseBody(startHubConversationSchema, request);

    const conversation = await deps.conversations.create(tenant, {
      id: deps.ids.generate(),
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      title: input.title ?? null,
    });

    const view: HubConversationView = {
      id: conversation.id,
      scope: conversation.scope,
      scopeId: conversation.scopeId,
      title: conversation.title,
      messages: [],
    };

    response.status(201).json(view);
  });

  router.get('/hub/conversations/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const conversation = await deps.conversations.findById(tenant, id);
    if (!conversation) throw new NotFoundError('NOT_FOUND', 'Conversa não encontrada.');

    const messages = await deps.conversations.listMessages(tenant, id, 100);

    const view: HubConversationView = {
      id: conversation.id,
      scope: conversation.scope,
      scopeId: conversation.scopeId,
      title: conversation.title,
      messages: await Promise.all(
        messages.map(async (message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          ...(message.attachments.length
            ? { attachments: await deps.attachments(tenant, message.attachments) }
            : {}),
          createdAt: message.createdAt.toISOString(),
        })),
      ),
    };

    response.json(view);
  });

  /**
   * Dispara uma operação. Responde com o canal SSE — a UI abre o stream e
   * acompanha; a resposta HTTP não espera a operação inteira.
   */
  router.post('/hub/conversations/:id/messages', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);
    const input = parseBody(sendHubMessageSchema, request);

    const conversation = await deps.conversations.findById(tenant, id);
    if (!conversation) throw new NotFoundError('NOT_FOUND', 'Conversa não encontrada.');

    /*
      O S.O ESCOLHE A OPERAÇÃO E O ALVO — a tela é pista, não cerca.

      `resolveOperation` continua valendo primeiro, mas o que restou dele é só
      recusar nome de operação que não existe. A checagem de ESCOPO saiu: ela
      era a cerca que prendia o S.O à tela, e o que ela protegia — cliente com
      estado velho rodando a operação de uma tela com o id de outra — passou a
      ser protegido de forma mais forte e mais específica, conferindo o alvo
      contra o inventário da conta POR TIPO (ver `account-inventory.ts`).

      Sem isto o produto tinha duas falhas com a mesma raiz: "cria a campanha de
      estamparia" com o chip em `refinar perfil` rodava refinar perfil e não
      criava nada; e pedir qualquer coisa sobre um projeto exigia primeiro
      NAVEGAR até ele, porque fora dali o S.O não sabia que ele existia.
    */
    const sugerida = resolveOperation(conversation.scope, input.operation);

    // As últimas falas vão ao roteador: "vincula ELE" e "sim, pode excluir" só
    // se resolvem sabendo o que veio antes.
    const recentes = await deps.conversations.listMessages(tenant, conversation.id, 4);

    const routed = await deps.router.execute(tenant, {
      scope: conversation.scope,
      ...(conversation.scopeId ? { scopeId: conversation.scopeId } : {}),
      message: input.content,
      ...(sugerida ? { suggested: sugerida.name } : {}),
      history: recentes.map((message) => ({
        role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      })),
    });

    // Uma AÇÃO do sistema: executada agora, pelo use case da tela.
    if (routed.action) {
      const acted = await deps.runner.act(tenant, {
        conversationId: conversation.id,
        userMessage: input.content,
        action: routed.action.spec,
        args: routed.action.args,
        costMicros: routed.costMicros,
        totalTokens: routed.totalTokens,
      });

      response.status(202).json({ operation: acted });
      return;
    }

    /*
      ELE NÃO SOUBE DE QUE COISA SE FALAVA — e perguntar é a resposta certa.

      "Ajusta o agente" numa conta com quatro agentes não tem resposta única, e
      adivinhar significa reconfigurar o errado em três de quatro vezes, num
      documento que o usuário nem estava olhando. A pergunta volta pelo mesmo
      caminho de uma resposta comum e custa o que já foi pago no roteamento —
      nenhuma operação chega a rodar.
    */
    if (!routed.operation) {
      const answered = await deps.runner.answer(tenant, {
        conversationId: conversation.id,
        userMessage: input.content,
        answer: routed.question ?? 'Não entendi o pedido. Pode reformular?',
        costMicros: routed.costMicros,
        totalTokens: routed.totalTokens,
      });

      response.status(202).json({ operation: answered });
      return;
    }

    const operation = routed.operation;

    const runInput = {
      conversationId: conversation.id,
      operation,
      userMessage: input.content,
      ...(routed.targetId ? { targetId: routed.targetId } : {}),
      ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
      ...(input.playbookKey ? { playbookKey: input.playbookKey } : {}),
      ...(input.testTranscript?.length ? { testTranscript: input.testTranscript } : {}),
      ...(input.syncCraft ? { syncCraft: true } : {}),
      // Trocar a operação em silêncio seria repetir o defeito com o sinal
      // invertido: o usuário pede uma coisa e o sistema faz outra sem dizer.
      ...(routed.overridden && routed.reason && input.operationPicked
        ? { routingNote: routed.reason }
        : {}),
      ...(routed.signals ? { requestSignals: routed.signals } : {}),
      priorCost: { costMicros: routed.costMicros, totalTokens: routed.totalTokens },
    };

    // Registra e responde IMEDIATAMENTE; o trabalho segue em segundo plano e a
    // UI acompanha pelo SSE. Esperar a operação inteira aqui faria o painel
    // receber tudo pronto de uma vez, em vez de ver o sistema trabalhando (§28).
    const begun = await deps.runner.begin(tenant, runInput);

    const view: HubOperationView = {
      id: begun.operationId,
      conversationId: conversation.id,
      operation: operation.name,
      status: 'RUNNING',
      channel: begun.channel,
      createdAt: new Date().toISOString(),
    };

    response.status(202).json({ operation: view });

    // O runner registra falha na própria operação e emite os eventos — MAS só
    // depois de ter começado. Uma exceção antes disso (montar contexto, ler
    // playbook, compilar prompt) não emite nada: a operação fica RUNNING para
    // sempre e o painel gira sem explicar. Engolir a rejeição aqui torna esse
    // caso INVISÍVEL, que é o pior desfecho possível para depurar.
    void deps.runner.resume(tenant, begun, runInput).catch((error: unknown) => {
      rootPinoLogger.error(
        { err: error, operationId: begun.operationId, operation: operation.name },
        'operação do OS falhou fora do runner',
      );
    });
  });

  /**
   * Stream de eventos de uma operação.
   *
   * O histórico persistido é reenviado a partir de `Last-Event-ID` antes de
   * acompanhar ao vivo — sem isso, um refresh no meio da operação deixa a UI
   * com um checklist congelado pela metade (§11).
   */
  router.get('/hub/operations/:id/events', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const lastEventId = Number(
      request.header('last-event-id') ?? request.query['lastEventId'] ?? 0,
    );
    const afterSeq = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

    const replay = await deps.operations.listEvents(tenant, id, afterSeq);

    openSseStream(request, response, {
      channel: operationChannel(id),
      bus: deps.bus,
      replay,
    });
  });

  return router;
}
