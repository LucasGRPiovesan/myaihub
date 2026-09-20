import { Bot } from 'lucide-react';
import { useHub } from '../features/hub/HubProvider';

/**
 * O botão que abre o MyAIHub, sempre no mesmo lugar.
 *
 * Ele existe para haver UMA porta. Antes cada tela chamava o OS do seu jeito —
 * um botão no cabeçalho aqui, uma caixa de texto embutida ali — e cada porta
 * nova trazia o seu formato de saída, o seu tratamento de erro e o seu lugar
 * para esquecer de carregar uma seção da policy.
 *
 * Fica no canto inferior direito porque é onde a mão já procura, e some quando
 * o painel está aberto: um botão que abre o que já está aberto é ruído.
 *
 * O pulso é discreto de propósito. Ele sinaliza "estou aqui e vivo", não
 * "clique em mim agora" — e para quem pediu menos movimento na tela, o
 * `prefers-reduced-motion` global já o desliga.
 */
export function HubLauncher() {
  const { state, open } = useHub();

  if (state.open) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Falar com o MyAIHub"
      className={[
        // ABA saindo da borda, na altura do olho — e não um botão pousado no
        // canto inferior. O painel entra pela direita: a porta dele estar
        // colada nessa mesma borda diz de onde ele vem antes de abrir.
        'fixed top-1/2 right-0 z-40 -translate-y-1/2',
        'flex h-14 w-9 items-center justify-center',
        // Só o lado de dentro é arredondado; o de fora encosta na borda da
        // tela. É o que faz a forma ler como aba, não como círculo cortado.
        'rounded-l-2xl bg-accent text-white',
        'shadow-[-6px_0_20px_-8px_var(--color-accent-ring)]',
        'transition-[width,background-color] duration-200 hover:w-11 hover:bg-accent-hover',
        'focus-visible:outline-2',
      ].join(' ')}
    >
      <span aria-hidden className="hub-pulse absolute inset-0 rounded-l-2xl bg-accent" />
      <Bot aria-hidden className="relative size-5" />
    </button>
  );
}
