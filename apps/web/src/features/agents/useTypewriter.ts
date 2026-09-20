import { useEffect, useState } from 'react';

/**
 * A fala do agente aparece GRADUALMENTE, como nos chats de IA que o usuário já
 * conhece — nunca de uma vez.
 *
 * Existe em arquivo próprio porque duas telas precisam do mesmo efeito: o Lab
 * já tinha, e o chat público não tinha nenhum — a resposta "brotava" inteira na
 * tela, sem a suavidade que o resto do produto tem. Duas implementações
 * divergiriam no primeiro ajuste de ritmo.
 *
 * Não é streaming de verdade — a resposta já chegou inteira do servidor. É a
 * diferença entre parecer que o agente está escrevendo e uma parede de texto
 * aparecendo de uma vez. Por CARACTERE, não por palavra: é o que dá a
 * suavidade contínua, em vez de um "salto" de palavra em palavra.
 */
const REVEAL_CHARS_PER_SECOND = 45;

/**
 * Teto da revelação inteira, independente do tamanho do texto.
 *
 * A 45 caracteres por segundo, uma resposta de 250 caracteres levava 5,5s para
 * terminar de aparecer — DEPOIS de já ter chegado. Somado ao turno, o usuário
 * esperava perto de dez segundos por uma resposta que o servidor produziu em
 * um. A animação existe para a resposta não brotar de uma vez; ela não existe
 * para medir o tempo de leitura de ninguém.
 *
 * Abaixo deste teto o ritmo continua o de antes — frases curtas, que são a
 * maioria, aparecem exatamente como apareciam.
 */
const MAX_REVEAL_MS = 900;

/**
 * Revela `text` progressivamente, caractere a caractere.
 *
 * Roda apenas na PRIMEIRA vez que o componente monta com este texto — como a
 * lista usa o id do turno como chave, a mensagem de uma resposta antiga nunca é
 * remontada, então ela nunca repete a animação sozinha.
 */
export function useTypewriter(text: string): { shown: string; done: boolean } {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!text) {
      setShown('');
      setDone(true);
      return;
    }

    // `Array.from` respeita par substituto/emoji — cortar por índice de string
    // partiria um caractere ao meio e piscaria por um quadro.
    const chars = Array.from(text);
    let frame: number;
    const start = performance.now();
    // Texto longo acelera até caber no teto; texto curto mantém o ritmo de
    // sempre. O que se preserva é o efeito, não a duração.
    const porSegundo = Math.max(REVEAL_CHARS_PER_SECOND, chars.length / (MAX_REVEAL_MS / 1000));

    const tick = (now: number): void => {
      const count = Math.max(1, Math.floor(((now - start) / 1000) * porSegundo));
      if (count >= chars.length) {
        setShown(text);
        setDone(true);
        return;
      }
      setShown(chars.slice(0, count).join(''));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Deps vazio DE PROPÓSITO: `text` só entra no efeito para animar a
    // revelação inicial. Reagir a mudanças reiniciaria a animação — e o texto
    // de um turno já criado nunca muda.
  }, []);

  return { shown, done };
}
