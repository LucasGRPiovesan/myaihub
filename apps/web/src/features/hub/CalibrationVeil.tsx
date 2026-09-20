import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A tela enquanto o S.O trabalha no que está aberto.
 *
 * Ela existe por duas razões, e a primeira é dinheiro: com o chat disponível
 * durante a calibração, o usuário conversa com uma configuração que está sendo
 * reescrita debaixo dele — a resposta que ele lê já não corresponde a nada, e
 * cada turno desses é token gasto para produzir confusão.
 *
 * A segunda é honestidade. Um spinner diria "espere"; isto diz "estou
 * trabalhando, e é assim que o trabalho está andando": os nós acendem conforme
 * o log do painel avança, então o movimento na tela corresponde a algo que
 * aconteceu de verdade. Barra de progresso inventada ensina a não confiar na
 * tela — a mesma razão pela qual o log do painel mostra carimbo de horário em
 * vez de porcentagem.
 */

/** Quantos nós a rede tem. Poucos, e legíveis — não é um protetor de tela. */
const NODES = 14;

interface Node {
  x: number;
  y: number;
  r: number;
  /** Atraso de fase, para a respiração não ficar em uníssono. */
  delay: number;
}

/**
 * A malha é sorteada UMA vez e congelada.
 *
 * Sortear a cada quadro faria a rede tremer; sortear a cada render a faria
 * saltar quando o log avançasse. O que muda com o trabalho é a luz, não a forma.
 */
function useMesh(): { nodes: Node[]; links: Array<[number, number]> } {
  return useMemo(() => {
    // Semente fixa: a mesma malha em toda calibração. Uma rede diferente a cada
    // vez pareceria estado diferente, e o estado é o mesmo.
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const nodes: Node[] = Array.from({ length: NODES }, () => ({
      x: 10 + random() * 80,
      y: 12 + random() * 76,
      r: 0.9 + random() * 1.5,
      delay: random() * 3,
    }));

    // Cada nó se liga aos dois mais próximos: dá a malha de membrana sem o
    // emaranhado de ligar todos com todos.
    const links: Array<[number, number]> = [];
    nodes.forEach((node, index) => {
      const vizinhos = nodes
        .map((outro, outroIndex) => ({
          outroIndex,
          distancia: (outro.x - node.x) ** 2 + (outro.y - node.y) ** 2,
        }))
        .filter((item) => item.outroIndex !== index)
        .sort((a, b) => a.distancia - b.distancia)
        .slice(0, 2);

      for (const vizinho of vizinhos) {
        const par: [number, number] = [
          Math.min(index, vizinho.outroIndex),
          Math.max(index, vizinho.outroIndex),
        ];
        if (!links.some(([a, b]) => a === par[0] && b === par[1])) links.push(par);
      }
    });

    return { nodes, links };
  }, []);
}

export function CalibrationVeil({
  /** O que o S.O está fazendo agora — a última linha do log dele. */
  status,
  /**
   * Quanto ele já andou.
   *
   * É o número de linhas do log, e cada linha nova acende a rede por um
   * instante. O pulso corresponde a algo que ACONTECEU; nada aqui é inventado.
   */
  steps,
}: {
  status: string;
  steps: number;
}) {
  const { nodes, links } = useMesh();
  const [flash, setFlash] = useState(0);
  const anterior = useRef(steps);

  useEffect(() => {
    if (steps === anterior.current) return;
    anterior.current = steps;
    setFlash((valor) => valor + 1);
    const timer = setTimeout(() => setFlash((valor) => valor - 1), 900);
    return () => clearTimeout(timer);
  }, [steps]);

  const aceso = flash > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full opacity-70"
      >
        <defs>
          <radialGradient id="veil-glow">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* O halo respira devagar: é o fundo, não o assunto. */}
        <circle cx="50" cy="50" r="42" fill="url(#veil-glow)" className="veil-breathe" />

        {links.map(([a, b]) => {
          const origem = nodes[a];
          const destino = nodes[b];
          if (!origem || !destino) return null;
          return (
            <line
              key={`${a}-${b}`}
              x1={origem.x}
              y1={origem.y}
              x2={destino.x}
              y2={destino.y}
              stroke="var(--color-accent)"
              strokeWidth={aceso ? 0.35 : 0.18}
              strokeOpacity={aceso ? 0.55 : 0.25}
              className="veil-link"
            />
          );
        })}

        {nodes.map((node, index) => (
          <circle
            key={index}
            cx={node.x}
            cy={node.y}
            r={aceso ? node.r * 1.5 : node.r}
            fill="var(--color-accent)"
            fillOpacity={aceso ? 0.9 : 0.45}
            className="veil-node"
            style={{ animationDelay: `${node.delay}s` }}
          />
        ))}
      </svg>

      <div className="relative flex flex-col items-center gap-2 px-6 text-center">
        <p className="text-[13px] font-medium tracking-tight text-text">
          O MyAIHub está trabalhando neste agente
        </p>
        {/*
          A última linha do log, e não uma frase genérica: é a mesma informação
          que o painel mostra ao lado, e é ela que responde "por que ainda não
          terminou".
        */}
        <p className="max-w-xs text-[12px] leading-relaxed text-text-muted">{status}</p>
        <p className="text-[11px] text-text-subtle">
          O teste volta assim que ele terminar — conversar agora seria falar com uma configuração
          que está sendo reescrita.
        </p>
      </div>
    </div>
  );
}
