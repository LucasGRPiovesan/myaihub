import { Check, Copy, ExternalLink, Globe } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Button, Card } from '../../design-system/primitives';
import { useCampaign } from './campaigns.api';

/**
 * O Chat Público, visto de dentro (§17 Fase 9).
 *
 * Esta tela existia como aviso de "chega na Fase 9" mesmo depois da Fase 9
 * pronta: quem publicava e clicava no item da sidebar lia que o que acabou de
 * publicar ainda não existe.
 *
 * Ela não é uma segunda implementação do chat — é o endereço e a PRÉVIA do
 * mesmo `/c/:publicId` que o público recebe, dentro de um iframe. Reimplementar
 * a conversa aqui daria dois comportamentos para a mesma pergunta, e o segundo
 * nunca receberia as correções do primeiro.
 *
 * E o que ela serve é a PUBLICAÇÃO, não a configuração atual — igual ao que o
 * público vê. Mostrar aqui a versão em edição faria esta tela mentir sobre a
 * única coisa que ela existe para responder: "o que está no ar?".
 */
export function CampaignPublicPage() {
  const { projectId, campaignId } = useParams();
  const { data: campaign, isPending } = useCampaign(campaignId);
  const [copiado, setCopiado] = useState(false);

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <SkeletonText lines={5} />
      </div>
    );
  }

  const publicId = campaign?.publicId ?? null;
  const caminho = publicId ? `/c/${publicId}` : null;
  const endereco = caminho ? `${window.location.origin}${caminho}` : null;

  async function copiar(): Promise<void> {
    if (!endereco) return;
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard negado por permissão: o endereço está à vista logo acima e
      // continua selecionável. Um alerta aqui seria ruído sobre algo resolvido.
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Globe aria-hidden className="size-5 text-text-muted" />
          Chat Público
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          A conversa que o público tem, servida pela versão PUBLICADA — não pela que você está
          editando.
        </p>
      </div>

      {!publicId && (
        <Card className="mt-5 p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            Esta campanha ainda não foi publicada, então não existe endereço público. Publique em{' '}
            <Link
              to={`/projetos/${projectId}/campanhas/${campaignId}`}
              className="text-accent hover:underline"
            >
              Visão Geral
            </Link>{' '}
            — publicar congela a versão atual e gera o endereço.
          </p>
        </Card>
      )}

      {publicId && caminho && (
        <>
          <Card className="mt-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="success">no ar</Badge>
                <span className="min-w-0 truncate font-mono text-[13px] text-text-muted">
                  {endereco}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copiar()}>
                  {copiado ? (
                    <Check aria-hidden className="size-4" />
                  ) : (
                    <Copy aria-hidden className="size-4" />
                  )}
                  {copiado ? 'Copiado' : 'Copiar'}
                </Button>
                <a
                  href={caminho}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-[13px] hover:border-border-strong hover:bg-surface-sunken"
                >
                  <ExternalLink aria-hidden className="size-4" />
                  Abrir
                </a>
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
              Quem abre este endereço não precisa de conta. Alterar a campanha ou o agente daqui
              para a frente não muda o que está no ar — isso exige publicar de novo, e o endereço
              continua o mesmo.
            </p>
          </Card>

          {/*
            Prévia pelo MESMO caminho que o público usa, sem sessão emprestada:
            o iframe é uma navegação de verdade, e a rota pública não passa pelo
            portão de login. Uma prévia que rodasse autenticada não provaria nada.
          */}
          <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border border-border">
            <iframe
              src={caminho}
              title="Prévia do chat público"
              className="size-full min-h-[28rem] bg-surface"
            />
          </div>
        </>
      )}
    </div>
  );
}
