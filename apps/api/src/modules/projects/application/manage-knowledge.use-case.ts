import {
  KNOWLEDGE_MAX_CONTENT,
  type CreateKnowledgeSourceInput as CreateInput,
  type KnowledgeSourceView,
} from '@myaihub/shared';
import { createHash } from 'node:crypto';
import type {
  AuditWriter,
  IdGenerator,
  WebContentReader,
} from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';
import type {
  KnowledgeRepository,
  KnowledgeSourceRecord,
} from '../domain/knowledge-repositories.js';

function toView(record: KnowledgeSourceRecord): KnowledgeSourceView {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    title: record.title,
    uri: record.uri,
    revisionNumber: record.revisionNumber,
    contentLength: record.contentLength,
    lastError: record.lastError,
    extractedAt: record.extractedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Fontes de conhecimento do projeto (§4.4, Fase 5).
 *
 * O que entra aqui é conteúdo de TERCEIRO — o site do cliente, um documento
 * que ele colou. Ele nunca vira instrução: é gravado como texto e injetado
 * como bloco `UNTRUSTED` no runtime (§9.1). Um "ignore as regras anteriores"
 * dentro de um PDF institucional é exatamente o cenário que essa separação
 * existe para cobrir.
 *
 * E o OS NÃO reescreve conhecimento. Ele muta configuração; conhecimento ele
 * LÊ. Pedir que o modelo resuma a base do cliente devolveria paráfrase — o
 * mesmo erro que já custou caro no playbook, com a diferença de que aqui o
 * texto perdido é um fato do negócio dele.
 */
export class ManageKnowledgeUseCase {
  constructor(
    private readonly deps: {
      knowledge: KnowledgeRepository;
      reader: WebContentReader;
      ids: IdGenerator;
      audit: AuditWriter;
    },
  ) {}

  async list(context: TenantContext, projectId: string): Promise<KnowledgeSourceView[]> {
    const sources = await this.deps.knowledge.listSources(context, projectId);
    return sources.map(toView);
  }

  /**
   * Cria a fonte e já extrai o conteúdo.
   *
   * Extrair na hora e não em fila: sem retorno imediato o usuário fica olhando
   * um "PENDING" sem saber se a URL dele é alcançável, e a resposta a essa
   * pergunta é o único motivo de ele ter colado a URL. A falha vira `FAILED`
   * com o motivo, não uma exceção — a fonte existe e ele pode reindexar.
   */
  async create(
    context: TenantContext,
    projectId: string,
    input: CreateInput,
  ): Promise<KnowledgeSourceView> {
    const source = await this.deps.knowledge.createSource(context, {
      id: this.deps.ids.generate(),
      projectId,
      kind: input.kind,
      title: input.title,
      uri: input.kind === 'URL' ? input.uri : null,
      createdBy: context.userId ?? 'system',
    });

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'knowledge.source_created',
      entityType: 'ProjectKnowledgeSource',
      entityId: source.id,
      metadata: { projectId, kind: input.kind },
    });

    await this.extract(context, source, input.kind === 'TEXT' ? input.content : null);

    const refreshed = await this.deps.knowledge.findSource(context, source.id);
    return toView(refreshed ?? source);
  }

  /** Busca de novo. Conteúdo idêntico não cria revisão — ver o repositório. */
  async reindex(context: TenantContext, sourceId: string): Promise<KnowledgeSourceView> {
    const source = await this.deps.knowledge.findSource(context, sourceId);
    if (!source) throw new NotFoundError('NOT_FOUND', 'Fonte não encontrada.');

    if (source.kind === 'TEXT') {
      throw new AppError(
        'VALIDATION_ERROR',
        'Fonte de texto não tem o que reindexar — edite o texto para criar uma revisão.',
        { httpStatus: 422 },
      );
    }

    await this.extract(context, source, null);

    const refreshed = await this.deps.knowledge.findSource(context, sourceId);
    return toView(refreshed ?? source);
  }

  /** Substituir o texto de uma fonte TEXT é criar revisão, não editar a antiga. */
  async replaceText(
    context: TenantContext,
    sourceId: string,
    content: string,
  ): Promise<KnowledgeSourceView> {
    const source = await this.deps.knowledge.findSource(context, sourceId);
    if (!source) throw new NotFoundError('NOT_FOUND', 'Fonte não encontrada.');

    if (source.kind !== 'TEXT') {
      throw new AppError('VALIDATION_ERROR', 'Esta fonte vem de uma URL. Use reindexar.', {
        httpStatus: 422,
      });
    }

    await this.extract(context, source, content);

    const refreshed = await this.deps.knowledge.findSource(context, sourceId);
    return toView(refreshed ?? source);
  }

  async remove(context: TenantContext, sourceId: string): Promise<void> {
    const source = await this.deps.knowledge.findSource(context, sourceId);
    if (!source) throw new NotFoundError('NOT_FOUND', 'Fonte não encontrada.');

    await this.deps.knowledge.deleteSource(context, sourceId);

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'knowledge.source_deleted',
      entityType: 'ProjectKnowledgeSource',
      entityId: sourceId,
      metadata: { projectId: source.projectId, title: source.title },
    });
  }

  /**
   * Congela as fontes prontas do projeto. Chamado pela publicação.
   *
   * `null` quando não há nenhuma: gravar um snapshot vazio no manifest faria
   * ele afirmar ter congelado conhecimento que não existe.
   */
  async snapshot(context: TenantContext, projectId: string): Promise<string | null> {
    return this.deps.knowledge.createSnapshot(context, {
      id: this.deps.ids.generate(),
      projectId,
      itemIds: [],
      newId: () => this.deps.ids.generate(),
    });
  }

  private async extract(
    context: TenantContext,
    source: KnowledgeSourceRecord,
    text: string | null,
  ): Promise<void> {
    let content = text;

    if (content === null) {
      if (!source.uri) {
        await this.deps.knowledge.markFailed(context, source.id, 'A fonte não tem endereço.');
        return;
      }

      // O reader carrega toda a defesa de SSRF e devolve `null` em vez de
      // lançar — endereço inalcançável ou proibido é caso normal aqui.
      const fetched = await this.deps.reader.read(source.uri);
      if (!fetched) {
        await this.deps.knowledge.markFailed(
          context,
          source.id,
          'Não foi possível ler esta página. Confira o endereço ou cole o conteúdo como texto.',
        );
        return;
      }
      content = fetched.text;
    }

    const trimmed = content.slice(0, KNOWLEDGE_MAX_CONTENT);

    if (trimmed.trim().length === 0) {
      await this.deps.knowledge.markFailed(
        context,
        source.id,
        'A página respondeu, mas sem texto legível.',
      );
      return;
    }

    await this.deps.knowledge.saveRevision(context, {
      sourceId: source.id,
      revision: {
        id: this.deps.ids.generate(),
        contentHash: createHash('sha256').update(trimmed).digest('hex'),
        extractedContent: trimmed,
      },
    });
  }
}
