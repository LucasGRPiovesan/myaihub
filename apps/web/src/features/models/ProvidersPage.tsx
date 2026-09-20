import type { ProviderName } from '@myaihub/shared';
import { CircleCheck, CircleX, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Badge, SkeletonText } from '../../design-system/feedback';
import { Button, Card, Field, Input, Switch, cx } from '../../design-system/primitives';
import {
  useProviders,
  useSaveProviderKey,
  useSetProviderEnabled,
  useTestProviderKey,
  type ProviderKeySlot,
  type ProviderStatus,
} from './providers.api';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  fake: 'Teste',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/**
 * Uma chave — o que está cadastrado agora, e uma div SEPARADA para trocar.
 *
 * A separação não é estética: o valor atual é o que a maioria das visitas a
 * esta tela só precisa CONFERIR ("a chave gratuita ainda é a mesma?"), e trocar
 * é um ato deliberado, raro, que merece o próprio espaço em vez de um campo de
 * texto sempre aberto convidando a mexer sem querer.
 */
function KeySlot({ provider, slot }: { provider: ProviderName; slot: ProviderKeySlot }) {
  const [trocando, setTrocando] = useState(false);
  const [valor, setValor] = useState('');
  const salvar = useSaveProviderKey();
  const testar = useTestProviderKey();

  const resultado = testar.data;

  async function testarAgora(): Promise<void> {
    await testar.mutateAsync({ provider, kind: slot.kind, ...(valor ? { apiKey: valor } : {}) });
  }

  function salvarAgora(): void {
    if (!valor.trim()) return;
    salvar.mutate(
      { provider, kind: slot.kind, apiKey: valor.trim() },
      {
        onSuccess: () => {
          setValor('');
          setTrocando(false);
        },
      },
    );
  }

  return (
    <div className="rounded-[var(--radius-control)] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text">{slot.label}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-text-muted">
            <KeyRound aria-hidden className="size-3.5 shrink-0 text-text-subtle" />
            {slot.configured ? (
              <span className="font-mono">{slot.masked}</span>
            ) : (
              <span className="text-text-subtle">Nenhuma chave cadastrada</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={testar.isPending}
            disabled={!slot.configured && !valor}
            onClick={() => void testarAgora()}
          >
            Testar conexão
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTrocando((atual) => !atual)}>
            {trocando ? 'Cancelar' : slot.configured ? 'Trocar' : 'Cadastrar'}
          </Button>
        </div>
      </div>

      {resultado && (
        <p
          role="status"
          className={cx(
            'mt-2 flex items-center gap-1.5 text-[12px]',
            resultado.ok ? 'text-success' : 'text-danger',
          )}
        >
          {resultado.ok ? (
            <CircleCheck aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <CircleX aria-hidden className="size-3.5 shrink-0" />
          )}
          {resultado.message}
        </p>
      )}

      {/*
        A div SEPARADA para trocar a chave — só aparece quando pedida. Trocar
        de chave não é o caminho comum desta tela, e um campo sempre visível
        convidaria a apagar sem querer o que já funciona.
      */}
      {trocando && (
        <div className="mt-3 border-t border-border pt-3">
          <Field
            label={`Nova ${slot.label.toLowerCase()}`}
            htmlFor={`key-${provider}-${slot.kind}`}
            hint="Fica cifrada em repouso; ninguém volta a ver o valor inteiro depois de salvar."
          >
            <Input
              id={`key-${provider}-${slot.kind}`}
              type="password"
              autoComplete="off"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              placeholder="Cole a chave aqui"
            />
          </Field>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              loading={salvar.isPending}
              disabled={!valor.trim()}
              onClick={salvarAgora}
            >
              Salvar
            </Button>
          </div>
          {salvar.isError && (
            <p role="alert" className="mt-1.5 text-[12px] text-danger">
              Não foi possível salvar a chave.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * OpenAI e Anthropic aceitam chave e testam de verdade, mas o MyAIHub ainda
 * não tem o adaptador que fala com eles em execução — a chave fica pronta
 * para quando ele existir. Dizer isso aqui evita a pergunta "cadastrei, por
 * que continua indisponível?".
 */
function AvisoSemAdaptador({ provider }: { provider: ProviderName }) {
  if (provider === 'gemini' || provider === 'fake') return null;
  return (
    <p className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-[12px] leading-relaxed text-text-muted">
      O MyAIHub ainda não tem o adaptador que executa pedidos neste provider — a chave pode ser
      cadastrada e testada, mas nenhum papel pode ser apontado para {PROVIDER_LABELS[provider]}{' '}
      enquanto isso não existir.
    </p>
  );
}

function ProviderCard({ status }: { status: ProviderStatus }) {
  const setEnabled = useSetProviderEnabled();

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <p className="text-[15px] font-semibold text-text">{PROVIDER_LABELS[status.provider]}</p>
          <Badge tone={status.available ? 'success' : 'neutral'}>
            {status.available ? 'em uso' : status.enabled ? 'sem chave' : 'desligado'}
          </Badge>
        </div>
        <Switch
          checked={status.enabled}
          disabled={setEnabled.isPending}
          label={
            status.enabled
              ? `Desligar ${PROVIDER_LABELS[status.provider]}`
              : `Ligar ${PROVIDER_LABELS[status.provider]}`
          }
          onChange={(enabled) => setEnabled.mutate({ provider: status.provider, enabled })}
        />
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {status.keys.map((slot) => (
          <KeySlot key={slot.kind} provider={status.provider} slot={slot} />
        ))}
      </div>

      <AvisoSemAdaptador provider={status.provider} />
    </Card>
  );
}

export function ProvidersPage() {
  const { data: providers, isPending, isError } = useProviders();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Provedores</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-muted">
        As chaves de cada provedor de IA, e se ele está ligado. O que fica escolhido aqui como
        provedor e modelo no chat do S.O e no Testar Agente é o que os demais usuários da conta
        passam a receber — inclusive na campanha já publicada.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {isPending && (
          <Card className="p-5">
            <SkeletonText lines={4} />
          </Card>
        )}
        {isError && (
          <Card className="p-5">
            <p role="alert" className="text-sm text-danger">
              Não foi possível carregar os provedores. Recarregue a página.
            </p>
          </Card>
        )}
        {providers?.map((status) => (
          <ProviderCard key={status.provider} status={status} />
        ))}
      </div>
    </div>
  );
}
