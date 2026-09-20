/**
 * O som de "terminei", sintetizado na hora.
 *
 * Nada de arquivo: o timbre inteiro nasce de osciladores e ruído, então não há
 * asset para baixar, cachear ou versionar — e o efeito soa igual offline, em
 * qualquer navegador com Web Audio. Um mp3 de meio segundo custaria mais bytes
 * que este arquivo e ainda precisaria de uma rota para servi-lo.
 *
 * A razão de existir é a mesma pela qual o painel mostra o log: uma operação do
 * S.O leva de 8 a 40 segundos, e ninguém fica olhando. Quem pediu um ajuste vai
 * para outra aba e volta quando lembra — o som é o que devolve o momento exato
 * do fim sem exigir que a tela esteja à vista.
 *
 * ========== O TIMBRE ==========
 *
 * Sino de FM, e não um bipe. Um oscilador senoidal modulado por outro numa
 * razão INARMÔNICA (2,01×) produz parciais que não são múltiplos inteiros da
 * fundamental — é isso que o ouvido lê como metal, e não como apito. A
 * modulação decai mais rápido que a nota, então o ataque tem brilho e a cauda
 * fica limpa, como num sino de verdade.
 *
 * Sobre ele: um sopro de ruído filtrado que sobe de 700Hz a 5kHz em 280ms (o
 * "ar" do início) e uma reverberação de resposta impulsiva sintética — ruído
 * decaindo, gerado em runtime. É a cauda que faz o som parecer que aconteceu
 * numa sala, e não dentro do alto-falante.
 *
 * As notas sobem (ré, lá, ré, mi) porque subir é resolver: um acorde
 * ascendente diz "acabou bem" sem precisar de palavra nenhuma. A falha usa o
 * caminho inverso — duas notas descendo uma terça menor, mais escuras e mais
 * curtas —, porque anunciar erro com o mesmo som do acerto é pior que não
 * anunciar.
 */

const STORAGE_KEY = 'myaihub.sound';

/** Volume geral. Baixo de propósito: isto avisa, não assusta. */
const MASTER_GAIN = 0.22;

let shared: AudioContext | null = null;

/**
 * O contexto de áudio, criado no PRIMEIRO uso.
 *
 * Navegador nenhum deixa tocar som antes de o usuário interagir com a página, e
 * criar o contexto no import faria todo carregamento nascer com um contexto
 * suspenso à toa. Aqui ele nasce depois de um clique — sempre, porque o som só
 * toca quando uma operação que o usuário mandou rodar termina.
 */
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  shared ??= new Ctor();
  // Voltar de uma aba em segundo plano costuma deixá-lo suspenso.
  if (shared.state === 'suspended') void shared.resume();

  return shared;
}

/**
 * Reverberação por resposta impulsiva SINTÉTICA.
 *
 * Ruído branco decaindo exponencialmente é a forma mais barata de uma cauda
 * convincente: dois canais descorrelacionados dão largura estéreo de graça, e o
 * buffer inteiro custa alguns milissegundos para gerar.
 */
function reverb(ctx: AudioContext, seconds: number, decay: number): ConvolverNode {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** decay;
    }
  }

  const node = ctx.createConvolver();
  node.buffer = impulse;
  return node;
}

/**
 * Uma nota de sino.
 *
 * `exponentialRampToValueAtTime` e não linear: o ouvido percebe volume em
 * escala logarítmica, e uma rampa linear soa como um corte no fim. O valor
 * nunca chega a zero porque a rampa exponencial não aceita zero — daí o
 * 0,0001, que é silêncio para qualquer efeito prático.
 */
function bell(
  ctx: AudioContext,
  destination: AudioNode,
  options: { freq: number; at: number; gain: number; decay: number; ratio?: number },
): void {
  const { freq, at, gain, decay, ratio = 2.01 } = options;

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = freq;

  // O modulador é quem cria os parciais metálicos. Ele decai mais rápido que a
  // nota: o brilho é do ATAQUE, e sustentá-lo deixaria o som áspero.
  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.value = freq * ratio;

  const modulationDepth = ctx.createGain();
  modulationDepth.gain.setValueAtTime(freq * 1.6, at);
  modulationDepth.gain.exponentialRampToValueAtTime(1, at + decay * 0.5);

  const amplitude = ctx.createGain();
  amplitude.gain.setValueAtTime(0.0001, at);
  amplitude.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  amplitude.gain.exponentialRampToValueAtTime(0.0001, at + decay);

  modulator.connect(modulationDepth).connect(carrier.frequency);
  carrier.connect(amplitude).connect(destination);

  modulator.start(at);
  modulator.stop(at + decay + 0.05);
  carrier.start(at);
  carrier.stop(at + decay + 0.05);
}

/** O sopro do início: ruído passa-banda subindo. É o que dá "ar" ao ataque. */
function air(ctx: AudioContext, destination: AudioNode, at: number, gain: number): void {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(700, at);
  filter.frequency.exponentialRampToValueAtTime(5200, at + 0.28);

  const amplitude = ctx.createGain();
  amplitude.gain.setValueAtTime(0.0001, at);
  amplitude.gain.exponentialRampToValueAtTime(gain, at + 0.04);
  amplitude.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);

  source.connect(filter).connect(amplitude).connect(destination);
  source.start(at);
  source.stop(at + 0.5);
}

/** Corpo grave e curto, para o som ter peso sem virar grave de festa. */
function body(ctx: AudioContext, destination: AudioNode, at: number, freq: number): void {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(freq, at);
  oscillator.frequency.exponentialRampToValueAtTime(freq * 0.75, at + 0.18);

  const amplitude = ctx.createGain();
  amplitude.gain.setValueAtTime(0.0001, at);
  amplitude.gain.exponentialRampToValueAtTime(0.12, at + 0.012);
  amplitude.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);

  oscillator.connect(amplitude).connect(destination);
  oscillator.start(at);
  oscillator.stop(at + 0.35);
}

export type SoundOutcome = 'completed' | 'failed';

/** Ligado por padrão, e a escolha do usuário fica na máquina dele. */
export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * O usuário está OLHANDO para a aplicação?
 *
 * O som existe para quem saiu: uma operação leva de 8 a 40 segundos e a pessoa
 * vai para outra aba, outra janela, outro monitor. Para quem está com o painel
 * na frente, ele não informa nada que a tela já não esteja dizendo — vira ruído
 * a cada pedido, e ruído que não informa é o que ensina a desligar o som.
 *
 * São duas perguntas diferentes e as duas importam: `visibilityState` pega a
 * aba trocada ou a janela minimizada; `hasFocus` pega a janela lado a lado, no
 * segundo monitor ou atrás do editor — visível e sem ninguém olhando.
 */
function estaLonge(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return true;
  // `hasFocus` não existe em todo ambiente de teste; a ausência não é "longe".
  return typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* armazenamento bloqueado: vale para esta aba e pronto */
  }
}

/**
 * Toca o fim de uma operação do S.O.
 *
 * Só toca com o usuário LONGE da tela — ver `estaLonge`. `force` existe para o
 * único caso em que isso não vale: o botão de ligar o som, onde a pessoa está
 * olhando de propósito e o som É a resposta ao clique dela.
 *
 * Falha aqui NUNCA derruba nada: é um aviso sonoro, e um navegador que recusa
 * áudio não pode impedir o usuário de ver que a operação terminou.
 */
export function playOutcome(outcome: SoundOutcome, options?: { force?: boolean }): void {
  if (!isSoundEnabled()) return;
  if (!options?.force && !estaLonge()) return;

  try {
    const ctx = audioContext();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    // A cauda entra em PARALELO com o som seco: só reverberação soaria distante,
    // só o seco soaria dentro do alto-falante.
    const tail = ctx.createGain();
    tail.gain.value = outcome === 'completed' ? 0.5 : 0.28;
    tail.connect(reverb(ctx, outcome === 'completed' ? 1.8 : 1.0, 3.2)).connect(master);

    const now = ctx.currentTime + 0.02;
    const voices = [master, tail];
    const toca = (options: Parameters<typeof bell>[2]): void => {
      for (const destination of voices) bell(ctx, destination, options);
    };

    if (outcome === 'completed') {
      // Ré · lá · ré · mi — subindo. A última é a nona, e é ela que dá o
      // brilho: entra mais baixa e mais longa, ficando no ar depois das outras.
      air(ctx, master, now, 0.05);
      body(ctx, master, now, 146.83);

      toca({ freq: 587.33, at: now, gain: 0.18, decay: 1.1 });
      toca({ freq: 880.0, at: now + 0.06, gain: 0.15, decay: 1.2 });
      toca({ freq: 1174.66, at: now + 0.12, gain: 0.12, decay: 1.4 });
      toca({ freq: 1318.51, at: now + 0.2, gain: 0.07, decay: 1.9, ratio: 3.01 });
      return;
    }

    // Falha: duas notas DESCENDO, mais escuras e mais curtas. Anunciar erro com
    // o som do acerto ensina o usuário a ignorar o som.
    body(ctx, master, now, 98);
    toca({ freq: 392.0, at: now, gain: 0.16, decay: 0.55, ratio: 1.41 });
    toca({ freq: 311.13, at: now + 0.11, gain: 0.14, decay: 0.8, ratio: 1.41 });
  } catch {
    /* áudio indisponível: o painel já mostrou o resultado na tela */
  }
}
