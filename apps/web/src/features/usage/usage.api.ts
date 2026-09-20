import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiRequest } from '../../lib/api-client';
import type { ExchangeRateView } from './cost';

export interface SpendSummary {
  month: { from: string; costMicros: number; totalTokens: number; calls: number };
  rate: ExchangeRateView;
  /**
   * Qual cota está servindo. Ausente quando o provider não distingue as duas.
   *
   * Vem junto do gasto porque é a mesma pergunta ("quanto isto está me
   * custando"): separá-las abriria a janela em que a tela mostra a cota de
   * agora com o total de antes.
   */
  quota?: {
    /** O que SERVIU a última chamada. Ausente quando ainda não houve nenhuma. */
    tier?: 'FREE' | 'PAID';
    at?: string;
    /** O que o adapter tentaria AGORA — previsão, usada para a trava e o horário. */
    next?: {
      tier: 'FREE' | 'PAID';
      freeAvailableAt: string | null;
      hasPaidKey: boolean;
    } | null;
  };
}

const spendKey = ['usage', 'spend'] as const;

/**
 * O quanto já foi gasto, para o cabeçalho do painel.
 *
 * A cotação vem JUNTO do total, e não de uma consulta separada: são o mesmo
 * dado para quem lê — "quanto isto me custou em reais" —, e duas consultas
 * abririam a janela em que a tela mostra um total convertido por uma cotação
 * que ainda não chegou.
 *
 * `staleTime` alto de propósito: o total muda quando uma operação termina, e é
 * o próprio fim da operação que manda recarregar (`useRefreshSpend`). Pesquisar
 * de tempos em tempos gastaria requisição para descobrir que nada mudou.
 */
export function useSpend() {
  return useQuery({
    queryKey: spendKey,
    queryFn: () => apiRequest<SpendSummary>('/api/metrics/spend'),
    staleTime: 5 * 60 * 1000,
  });
}

/** Chamado quando um turno termina: é aí que o total muda. */
export function useRefreshSpend(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: spendKey });
  }, [queryClient]);
}
