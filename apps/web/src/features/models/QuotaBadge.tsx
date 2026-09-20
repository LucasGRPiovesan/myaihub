import { Switch } from '../../design-system/primitives';
import { useSpend } from '../usage/usage.api';
import { useProviders, useSetGeminiForcedPaid } from './providers.api';

function horario(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

/**
 * Qual COTA serviu a última chamada — só em desenvolvimento.
 *
 * Em produção isto seria ruído: quem usa o produto não decide de qual bolso a
 * chamada sai. Em desenvolvimento é o contrário — é a diferença entre estar
 * testando de graça e estar torrando a chave paga a cada tecla.
 *
 * ========== NÃO-ADMIN: MOSTRA O QUE ACONTECEU (FATO, não previsão) ==========
 *
 * Baseado em `useSpend()` (`ai_calls`) — o que a ÚLTIMA chamada de fato usou.
 * A primeira versão mostrava a previsão do adapter, e previsão reinicia junto
 * do processo: depois de um restart ele volta a supor que a gratuita está de
 * pé, e a Topbar dizia "cota gratuita" enquanto as chamadas saíam pela paga.
 *
 * ========== ADMIN: MOSTRA O QUE A PRÓXIMA CHAMADA VAI USAR ==========
 *
 * Para o admin o switch é ACIONÁVEL — ele pode forçar a paga —, e "o que
 * aconteceu" deixa de bastar: forçar, testar uma vez e desligar a força deixa
 * o ÚLTIMO registro de `ai_calls` apontando PAGA mesmo com a gratuita livre de
 * novo, e o badge ficaria preso dizendo "cota esgotada" sobre uma cota que
 * nunca foi tocada. Medido — foi exatamente o que aconteceu na primeira versão
 * desta troca. Por isso o admin lê o estado VIVO do anel de chaves
 * (`GET /admin/providers` → `tier`/`freeAvailableAt`, calculados por
 * `GeminiKeyRing.select()` a cada leitura), não o histórico.
 */
export function QuotaBadge({ isAdmin }: { isAdmin: boolean }) {
  const { data: spend } = useSpend();
  const { data: providers } = useProviders({ enabled: isAdmin });
  const setForcedPaid = useSetGeminiForcedPaid();

  // Ruído para quem só usa o produto — mas o admin é quem decide de qual
  // bolso a chamada sai, e esta conta ainda não tem usuário que não seja o
  // dono testando (2026-09-20). Fora do DEV, some para todo mundo que não é
  // admin; nunca aparece pra quem não pode agir sobre ele.
  if (!import.meta.env.DEV && !isAdmin) return null;

  const gemini = providers?.find((linha) => linha.provider === 'gemini');
  const forcedPaid = gemini?.forcedPaid ?? false;

  // Admin com o estado vivo disponível: usa-o. Sem ele (não-admin, ou ainda
  // carregando), cai no histórico de `useSpend()` — o comportamento de
  // sempre, preservado para quem não pode forçar nada mesmo.
  const tierAoVivo = isAdmin ? gemini?.tier : undefined;
  const servida = tierAoVivo ?? spend?.quota?.tier;
  if (!servida) return null;

  const gratuita = servida === 'FREE';

  const quando = spend?.quota?.at ? horario(spend.quota.at) : null;

  // O horário de volta: do estado VIVO para o admin (é ele que rege o
  // switch); da previsão do adapter para quem só observa. Previsão que
  // discorda do fato some — depois de um restart ela não sabe mais nada.
  const freeAvailableAt = isAdmin
    ? (gemini?.freeAvailableAt ?? null)
    : !gratuita && spend?.quota?.next?.freeAvailableAt
      ? spend.quota.next.freeAvailableAt
      : null;
  const volta = freeAvailableAt ? horario(freeAvailableAt) : null;

  const titulo = isAdmin
    ? (forcedPaid
        ? 'Você forçou a chave PAGA do Gemini. Clique para voltar ao automático.'
        : gratuita
          ? 'A chave GRATUITA está disponível. Clique para forçar a PAGA.'
          : `A cota gratuita do dia acabou — usando a PAGA. Clique para manter forçado.${
              volta ? ` A gratuita volta por volta de ${volta}.` : ''
            }`) + (quando ? ` Última chamada às ${quando}.` : '')
    : (gratuita
        ? 'A última chamada saiu pela chave GRATUITA do Gemini.'
        : 'A última chamada saiu pela chave PAGA — a cota gratuita do dia acabou.') +
      (quando ? ` Foi às ${quando}.` : '') +
      (volta ? ` A gratuita volta por volta de ${volta}.` : '') +
      ' A troca é automática.';

  // "Ligado" reflete o que VAI SERVIR agora: a escolha, quando forçada; o
  // fato, quando não. Sem isso, desligar a força enquanto a cota ainda está
  // esgotada de verdade mostraria "gratuita" com a chamada real saindo pela
  // paga — o mesmo erro, mas ao contrário.
  const ligado = forcedPaid || !gratuita;

  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted"
      title={titulo}
    >
      <span className={gratuita && !forcedPaid ? 'text-success' : 'text-warning'}>
        {forcedPaid ? 'paga (forçado)' : gratuita ? 'gratuita' : 'paga'}
      </span>
      <Switch
        checked={ligado}
        disabled={!isAdmin || setForcedPaid.isPending}
        label={titulo}
        {...(isAdmin
          ? { onChange: (checked: boolean) => setForcedPaid.mutate({ forcedPaid: checked }) }
          : {})}
      />
    </span>
  );
}
