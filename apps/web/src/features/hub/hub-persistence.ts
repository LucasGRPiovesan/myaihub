import type { HubTurn } from './hub-state';

/**
 * O transcrito do painel entre um carregamento e outro.
 *
 * O painel guarda UM histórico, contínuo, e ele precisa sobreviver a um F5 —
 * senão a conversa com o OS é a única do sistema que se perde ao recarregar,
 * logo depois de as conversas do agente terem deixado de se perder.
 *
 * `sessionStorage` e não `localStorage`: o recorte pedido é a SESSÃO DE LOGIN.
 * Em `localStorage`, o transcrito voltaria semanas depois, com respostas sobre
 * uma configuração que já mudou — e o painel passaria a mostrar como atual algo
 * que não é.
 *
 * A chave carrega o USUÁRIO: numa máquina compartilhada, quem entra depois não
 * pode ler a conversa de quem saiu. E `forgetHubHistory` roda no logout, para
 * não depender de a aba fechar.
 *
 * Só turnos ENCERRADOS são guardados. O turno em curso pertence a um stream que
 * já morreu quando a página recarrega; restaurá-lo mostraria um checklist
 * girando para sempre.
 */
const PREFIX = 'myaihub.hub.history';

/** Teto do que se guarda. Além disso é histórico, não conversa em andamento. */
const MAX_TURNS = 40;

function key(userId: string): string {
  return `${PREFIX}.${userId}`;
}

export function readHubHistory(userId: string): HubTurn[] {
  try {
    const bruto = sessionStorage.getItem(key(userId));
    if (!bruto) return [];

    const lido: unknown = JSON.parse(bruto);
    if (!Array.isArray(lido)) return [];

    // Validação mínima de FORMA: o que está aqui foi gravado por uma versão
    // anterior da tela, e um turno sem `context` quebraria o agrupamento no
    // primeiro render. Descartar o malformado é melhor que derrubar o painel.
    return lido.filter(
      (turno): turno is HubTurn =>
        typeof turno === 'object' &&
        turno !== null &&
        typeof (turno as HubTurn).id === 'string' &&
        typeof (turno as HubTurn).request === 'string' &&
        typeof (turno as HubTurn).context?.key === 'string',
    );
  } catch {
    // Armazenamento bloqueado ou JSON corrompido: o painel funciona, só não
    // retoma. Derrubar a tela por causa do histórico seria desproporcional.
    return [];
  }
}

export function writeHubHistory(userId: string, turns: HubTurn[]): void {
  try {
    sessionStorage.setItem(key(userId), JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* idem */
  }
}

/**
 * Apaga o histórico ao sair.
 *
 * Sem `userId`, varre tudo: o logout pode acontecer com a sessão já expirada, e
 * aí não há de quem era. Deixar para trás a conversa de quem saiu é o oposto do
 * que "limpa ao deslogar" promete.
 */
export function forgetHubHistory(userId?: string): void {
  try {
    if (userId) {
      sessionStorage.removeItem(key(userId));
      return;
    }

    for (const chave of Object.keys(sessionStorage)) {
      if (chave.startsWith(PREFIX)) sessionStorage.removeItem(chave);
    }
  } catch {
    /* idem */
  }
}
