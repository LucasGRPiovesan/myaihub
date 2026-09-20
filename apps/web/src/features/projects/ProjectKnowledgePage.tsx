import { KNOWLEDGE_SOURCE_KIND_LABELS, type KnowledgeSourceView } from '@myaihub/shared';
import { AlertTriangle, FileText, Globe, Info, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Button, Card, Field, IconButton, Input, cx } from '../../design-system/primitives';
import {
  useCreateKnowledgeSource,
  useDeleteKnowledgeSource,
  useKnowledgeSources,
  useReindexKnowledgeSource,
  useReplaceKnowledgeText,
} from './project-assets.api';
import { useProject } from './projects.api';

/**
 * Conhecimento do negócio (§4.4, Fase 5).
 *
 * O que o usuário precisa entender desta tela, e por isso está escrito nela: o
 * conteúdo é CONGELADO quando a campanha é publicada. Reindexar uma página hoje
 * não muda o que uma publicação de ontem responde — e sem dizer isso, a
 * primeira vez que ele reindexar e não vir diferença no ar vai parecer um bug.
 */
function StatusBadge({ source }: { source: KnowledgeSourceView }) {
  if (source.status === 'READY') {
    return <Badge tone="success">indexada · r{source.revisionNumber}</Badge>;
  }
  if (source.status === 'FAILED') return <Badge tone="danger">falhou</Badge>;
  return <Badge tone="neutral">processando</Badge>;
}

export function ProjectKnowledgePage() {
  const { projectId } = useParams();
  const { data: project } = useProject(projectId);
  const { data: sources, isPending, isError } = useKnowledgeSources(projectId);
  const create = useCreateKnowledgeSource(projectId);
  const reindex = useReindexKnowledgeSource(projectId);
  const remove = useDeleteKnowledgeSource(projectId);
  const replace = useReplaceKnowledgeText(projectId);

  /** Qual fonte está sendo editada, e o rascunho dela. */
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');

  const [kind, setKind] = useState<'TEXT' | 'URL'>('URL');
  const [title, setTitle] = useState('');
  const [uri, setUri] = useState('');
  const [content, setContent] = useState('');

  const valido =
    title.trim().length > 0 && (kind === 'URL' ? uri.trim() : content.trim()).length > 0;

  function adicionar() {
    if (!valido) return;

    create.mutate(
      kind === 'URL'
        ? { kind: 'URL', title: title.trim(), uri: uri.trim() }
        : { kind: 'TEXT', title: title.trim(), content: content.trim() },
      {
        onSuccess: () => {
          setTitle('');
          setUri('');
          setContent('');
        },
      },
    );
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={5} />
      </div>
    );
  }

  if (isError || !sources) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger">
            Não foi possível carregar as fontes.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Conhecimento</h1>
      <p className="mt-1 text-sm text-text-muted">{project?.name}</p>

      <p className="mt-4 text-sm leading-relaxed text-text-muted">
        O que o agente pode CONSULTAR para responder com precisão: catálogo, política de troca,
        página de perguntas frequentes. Diferente das regras do projeto, isto não obriga nada — é
        material de consulta.
      </p>

      <Card className="mt-4 flex items-start gap-3 p-4">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
        <p className="text-[13px] leading-relaxed text-text-muted">
          Ao publicar uma campanha, as fontes prontas são{' '}
          <strong className="font-medium text-text">congeladas</strong> na revisão do momento.
          Reindexar depois não muda o que já está no ar — é o que garante que a conversa do público
          não mude de conteúdo sozinha. Para levar a atualização ao ar, publique de novo.
        </p>
      </Card>

      <Card className="mt-5 p-5">
        <p className="text-[13px] font-medium text-text">Adicionar fonte</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['URL', 'TEXT'] as const).map((opcao) => (
            <label
              key={opcao}
              className={cx(
                'cursor-pointer rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px]',
                kind === opcao
                  ? 'border-border-strong bg-surface-sunken text-text'
                  : 'border-border text-text-muted',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                checked={kind === opcao}
                onChange={() => setKind(opcao)}
              />
              {KNOWLEDGE_SOURCE_KIND_LABELS[opcao]}
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <Field label="Título" htmlFor="knowledge-title">
            <Input
              id="knowledge-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Política de troca"
            />
          </Field>

          {kind === 'URL' ? (
            <Field
              label="Endereço"
              htmlFor="knowledge-uri"
              hint="Buscamos o conteúdo agora e guardamos o texto extraído."
            >
              <Input
                id="knowledge-uri"
                value={uri}
                onChange={(event) => setUri(event.target.value)}
                placeholder="https://exemplo.com.br/trocas"
              />
            </Field>
          ) : (
            <Field label="Conteúdo" htmlFor="knowledge-content">
              <textarea
                id="knowledge-content"
                value={content}
                rows={6}
                onChange={(event) => setContent(event.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
                placeholder="Cole aqui o texto que o agente pode consultar."
              />
            </Field>
          )}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={adicionar} disabled={!valido} loading={create.isPending}>
              Adicionar
            </Button>
            {create.isError && (
              <span role="alert" className="text-[13px] text-danger">
                {create.error.message}
              </span>
            )}
          </div>
        </div>
      </Card>

      {sources.length === 0 ? (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Nenhuma fonte ainda. O agente responde só com o que está configurado no projeto e nele
            mesmo — o que já é bastante, mas não inclui catálogo nem política.
          </p>
        </Card>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {sources.map((source) => (
            <li key={source.id}>
              <Card className="flex items-start gap-3 p-4">
                {source.kind === 'URL' ? (
                  <Globe aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
                ) : (
                  <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-text">{source.title}</p>
                    <StatusBadge source={source} />
                  </div>

                  {source.uri && (
                    <p className="mt-0.5 truncate text-[12px] text-text-subtle">{source.uri}</p>
                  )}

                  <p className="mt-1 text-[12px] text-text-muted">
                    {source.contentLength > 0
                      ? `${source.contentLength.toLocaleString('pt-BR')} caracteres`
                      : 'sem conteúdo extraído'}
                    {source.extractedAt
                      ? ` · ${new Date(source.extractedAt).toLocaleString('pt-BR')}`
                      : ''}
                  </p>

                  {source.lastError && (
                    <p className="mt-2 flex items-start gap-1.5 text-[12px] text-danger">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      {source.lastError}
                    </p>
                  )}

                  {editando === source.id && (
                    <div className="mt-3 flex flex-col gap-2">
                      <label htmlFor={`edit-${source.id}`} className="sr-only">
                        Novo conteúdo
                      </label>
                      <textarea
                        id={`edit-${source.id}`}
                        value={rascunho}
                        rows={5}
                        onChange={(event) => setRascunho(event.target.value)}
                        placeholder="Cole o texto atualizado. A revisão anterior continua no ar até você republicar."
                        className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={rascunho.trim().length === 0}
                          loading={replace.isPending}
                          onClick={() =>
                            replace.mutate(
                              { sourceId: source.id, content: rascunho.trim() },
                              { onSuccess: () => setEditando(null) },
                            )
                          }
                        >
                          Salvar revisão
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {/* Texto se edita; página se reindexa. São ações
                      diferentes porque a fonte da verdade é outra. */}
                  {source.kind === 'TEXT' && (
                    <IconButton
                      label="Editar texto"
                      onClick={() => {
                        setEditando(source.id);
                        setRascunho('');
                      }}
                    >
                      <Pencil aria-hidden className="size-4" />
                    </IconButton>
                  )}
                  {source.kind === 'URL' && (
                    <IconButton
                      label="Reindexar"
                      onClick={() => reindex.mutate(source.id)}
                      loading={reindex.isPending && reindex.variables === source.id}
                    >
                      <RefreshCw aria-hidden className="size-4" />
                    </IconButton>
                  )}
                  <IconButton
                    label="Remover"
                    onClick={() => remove.mutate(source.id)}
                    loading={remove.isPending && remove.variables === source.id}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </IconButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
