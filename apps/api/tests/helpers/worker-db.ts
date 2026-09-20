import { closeSync, mkdirSync, openSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Um banco por worker de teste.
 *
 * A suÃ­te de integraÃ§Ã£o era serializada num processo sÃ³ (`singleFork`) porque
 * todos os arquivos compartilhavam UM banco e se limpavam por truncate: dois
 * rodando juntos truncavam as tabelas um do outro. Serializar resolvia a
 * corrida pagando o tempo inteiro â€” oito arquivos em fila, ~310s.
 *
 * Dar um banco a cada worker remove a causa em vez do sintoma. O truncate
 * continua igual, sÃ³ que ninguÃ©m mais divide a tabela com ninguÃ©m.
 *
 * O nÃºmero nÃ£o vem de `cpus()`: o gargalo Ã© o MySQL em Docker num disco
 * mecÃ¢nico, nÃ£o CPU. Acima disso os workers disputam o mesmo disco e o ganho
 * vira perda â€” medido.
 */
export const TEST_WORKER_COUNT = 4;

const LOCK_DIR = join(tmpdir(), 'myaihub-test-slots');

/** Chamado uma vez pelo globalSetup: lock Ã³rfÃ£o de um run morto trava o prÃ³ximo. */
export function resetSlots(): void {
  rmSync(LOCK_DIR, { recursive: true, force: true });
  mkdirSync(LOCK_DIR, { recursive: true });
}

let held: { slot: number; lock: string } | null = null;

function tryClaim(): number | null {
  for (let slot = 1; slot <= TEST_WORKER_COUNT; slot += 1) {
    const lock = join(LOCK_DIR, `slot-${slot}.lock`);
    try {
      closeSync(openSync(lock, 'wx'));
    } catch {
      continue;
    }

    held = { slot, lock };
    // Rede de seguranÃ§a para o worker que morre no meio: sem isso o banco dele
    // ficaria reservado pelo resto do run.
    process.on('exit', releaseSlot);
    return slot;
  }
  return null;
}

/**
 * Reserva um banco livre, esperando se preciso.
 *
 * `open(..., "wx")` falha quando o arquivo existe, e essa falha Ã‰ a exclusÃ£o
 * mÃºtua: nÃ£o hÃ¡ janela entre verificar e criar. `VITEST_POOL_ID` parecia
 * resolver e nÃ£o resolve â€” com forks isolados cada ARQUIVO ganha um id novo, e
 * reduzi-los por mÃ³dulo dava a dois workers VIVOS o mesmo banco.
 *
 * ESPERAR, e nÃ£o falhar, porque quantos forks o vitest mantÃ©m vivos nÃ£o Ã© algo
 * que este arquivo controle: `maxForks` nÃ£o Ã© respeitado de forma confiÃ¡vel
 * quando a suÃ­te roda pelo config raiz. Esperar transforma o nÃºmero de bancos
 * no limite REAL de concorrÃªncia contra o MySQL, que Ã© o que se queria limitar.
 */
export async function claimSlot(): Promise<number> {
  if (held) return held.slot;

  for (;;) {
    const slot = tryClaim();
    if (slot !== null) return slot;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Devolve o banco ao terminar o ARQUIVO, nÃ£o o processo.
 *
 * Ã‰ o que torna isto independente do modo de isolamento: com forks isolados
 * cada arquivo Ã© um processo novo, e segurar atÃ© a saÃ­da esgotava os quatro
 * bancos no quinto arquivo.
 */
export function releaseSlot(): void {
  if (!held) return;
  try {
    unlinkSync(held.lock);
  } catch {
    // JÃ¡ removido pelo reset do prÃ³ximo run â€” nada a fazer.
  }
  held = null;
}

/**
 * Troca o nome do banco na URL, preservando host, credenciais e query.
 *
 * Manipular por `URL` e nÃ£o por regex: a senha pode conter barra, e um replace
 * ingÃªnuo apontaria a suÃ­te para um banco que nÃ£o Ã© o de teste â€” que Ã©
 * exatamente o cenÃ¡rio que o helper de truncate existe para impedir.
 */
export function databaseUrlForWorker(baseUrl: string, index: number): string {
  const url = new URL(baseUrl);
  const name = url.pathname.replace(/^\//, '') || 'myaihub_test';
  url.pathname = `/${name}_${index}`;
  return url.toString();
}
