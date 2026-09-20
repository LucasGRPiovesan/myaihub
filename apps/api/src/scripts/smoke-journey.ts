/**
 * A jornada do usuário, ponta a ponta, contra o provider REAL.
 *
 * Existe porque `verify:full` passa verde com o produto quebrado: os testes
 * usam `FakeProvider` (invariante 8, e ela não se negocia — teste não gasta API
 * paga). O que o Fake não reproduz é o comportamento do provider de verdade, e
 * é exatamente ali que as últimas regressões moraram: raciocínio que atrasa a
 * primeira palavra, stream que abre e não escreve, geração longa que estoura o
 * prazo. Nenhuma delas apareceria em teste nenhum desta suíte.
 *
 * Então isto não substitui `verify:full` — cobre o que ela estruturalmente não
 * alcança. Rode antes de declarar pronta qualquer mudança em provider, prompt,
 * schema de saída ou instrução de operação:
 *
 *   npm run smoke:journey
 *
 * Exercita o que o usuário faz: briefing → criar agente → conversar no Lab →
 * ajustar pelo OS. Sai com código != 0 se qualquer etapa quebrar.
 */
import 'dotenv/config';

const API = process.env['SMOKE_API_URL'] ?? 'http://localhost:3333';
const EMAIL = process.env['SMOKE_EMAIL'] ?? 'admin@myaihub.local';
const PASSWORD = process.env['SMOKE_PASSWORD'];

let cookie = '';

async function call(
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });

  const set = res.headers.getSetCookie();
  if (set.length > 0) cookie = set.map((item) => item.split(';')[0]).join('; ');

  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, body: { raw: text } };
  }
}

const FACETAS = [
  'personality',
  'communication',
  'skills',
  'behaviors',
  'strategies',
  'hardRules',
  'limits',
] as const;

const falhas: string[] = [];

function checar(etapa: string, ok: boolean, detalhe: string): void {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${etapa.padEnd(24)} ${detalhe}`);
  if (!ok) falhas.push(etapa);
}

/**
 * Espera o desfecho pelo MESMO canal que o browser usa.
 *
 * Ler o estado por polling testaria menos: o painel só sabe que a operação
 * terminou porque o evento chega, e um desfecho que não chega ao SSE é um
 * painel girando para sempre — que foi exatamente um dos sintomas relatados.
 */
async function aguardar(id: string, tetoMs: number): Promise<string> {
  const res = await fetch(`${API}/api/hub/operations/${id}/events`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: AbortSignal.timeout(tetoMs),
  });

  if (!res.ok || !res.body) return `SSE_${res.status}`;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return 'STREAM_ENCERRADO';

      buffer += decoder.decode(value, { stream: true });
      const blocos = buffer.split('\n\n');
      buffer = blocos.pop() ?? '';

      for (const bloco of blocos) {
        const linha = bloco.split('\n').find((item) => item.startsWith('data:'));
        if (!linha) continue;

        const evento = JSON.parse(linha.slice(5).trim()) as {
          type?: string;
          status?: string;
          errorCode?: string;
        };

        if (evento.type !== 'operation.completed') continue;
        return evento.status === 'completed' ? 'COMPLETED' : `FAILED: ${evento.errorCode ?? '?'}`;
      }
    }
  } catch {
    return 'SEM_RESPOSTA';
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Itens que dizem quase a mesma coisa.
 *
 * O piso do ofício é aplicado pelo domínio e o modelo escreve por cima. Quando
 * ele não percebe que o item já existe, escreve outro com as próprias palavras
 * — e o agente termina com 56 itens onde 30 bastavam, pares em 100% ("Nada de
 * escassez falsa" e "Não cria urgência ou escassez falsa"), cada duplicata
 * disputando atenção com a outra e livre para divergir dela.
 */
function duplicatas(canonical: Record<string, unknown> | undefined): string[] {
  const palavras = (texto: string): Set<string> =>
    new Set(
      texto
        .toLowerCase()
        .replace(/[^a-zà-ús]/g, ' ')
        .split(/s+/)
        .filter((palavra) => palavra.length > 4),
    );

  const pares: string[] = [];

  for (const faceta of FACETAS) {
    const itens = (canonical?.[faceta] ?? []) as Array<{ code: string; statement: string }>;

    for (let a = 0; a < itens.length; a += 1) {
      for (let b = a + 1; b < itens.length; b += 1) {
        const pa = palavras(itens[a]!.statement);
        const pb = palavras(itens[b]!.statement);
        const comum = [...pa].filter((palavra) => pb.has(palavra)).length;
        const jaccard = comum / (pa.size + pb.size - comum);

        if (jaccard > 0.5) {
          pares.push(`${itens[a]!.code}~${itens[b]!.code} (${Math.round(jaccard * 100)}%)`);
        }
      }
    }
  }

  return pares;
}

function contarItens(canonical: Record<string, unknown> | undefined): number {
  return FACETAS.reduce((soma, chave) => {
    const itens = canonical?.[chave];
    return soma + (Array.isArray(itens) ? itens.length : 0);
  }, 0);
}

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error('Defina SMOKE_PASSWORD com a senha do usuário de teste.');

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  checar('login', login.status === 200, String(login.status));
  if (login.status !== 200) return;

  // --- briefing: as perguntas saem do playbook, sem custo de modelo --------
  let at = Date.now();
  const briefing = await call('/api/agents/briefing', {
    method: 'POST',
    body: JSON.stringify({
      role: 'Representante comercial consultivo',
      playbookKey: 'sales.consultive',
    }),
  });
  const perguntas = briefing.body['questions'];
  const quantas = Array.isArray(perguntas) ? perguntas.length : 0;
  checar(
    'briefing',
    briefing.status === 200 && quantas > 0,
    `${Date.now() - at}ms · ${quantas} perguntas`,
  );

  // --- criação do agente: a operação mais pesada do sistema ----------------
  const conversa = await call('/api/hub/conversations', {
    method: 'POST',
    body: JSON.stringify({ scope: 'ROOT' }),
  });
  checar('conversa do painel', conversa.status === 201, String(conversa.status));

  const brief = [
    'Representante comercial consultivo.',
    'Setor: plataforma online que conecta prestadores de serviço a clientes da região.',
    'Nunca pode prometer resolver o problema do usuário nem garantir clientes.',
    'Quem começa a conversa é o AGENTE.',
  ].join('\n');

  at = Date.now();
  const disparo = await call(`/api/hub/conversations/${String(conversa.body['id'])}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: brief,
      operation: 'agent.create',
      playbookKey: 'sales.consultive',
    }),
  });
  const operacao = disparo.body['operation'] as { id?: string } | undefined;
  checar(
    'disparo da criação',
    disparo.status === 202 && Boolean(operacao?.id),
    String(disparo.status),
  );
  if (!operacao?.id) return;

  const statusCriacao = await aguardar(operacao.id, 240_000);
  checar(
    'criação do agente',
    statusCriacao === 'COMPLETED',
    `${Date.now() - at}ms · ${statusCriacao}`,
  );

  // --- o agente nasceu com ofício? ----------------------------------------
  const agentes = await call('/api/agents');
  const lista = agentes.body['items'];
  const agente = (Array.isArray(lista) ? lista : [])[0] as { id: string; name: string } | undefined;

  // Segue mesmo se a criação falhou, desde que exista algum agente: uma etapa
  // ruim não pode esconder o estado das outras. Um relatório que para na
  // primeira falha esconde as três seguintes, e foi exatamente assim que a
  // conversa do Lab passou uma rodada inteira sem ser verificada.
  checar('agente disponível', Boolean(agente), agente?.name ?? 'nenhum');
  if (!agente) return;

  const detalhe = await call(`/api/agents/${agente.id}`);
  const configuracao = detalhe.body['configuration'] as
    { canonical: Record<string, unknown> } | undefined;
  const craft = detalhe.body['craft'] as { key: string; currentVersion: number } | null;
  const itens = contarItens(configuracao?.canonical);

  // Agente magro é pior que erro: ele PARECE pronto. O piso com playbook é 25+;
  // 15 é a margem que separa "veio com ofício" de "veio genérico".
  checar('agente tem ofício', itens >= 15, `${itens} itens`);

  const repetidos = duplicatas(configuracao?.canonical);
  checar(
    'sem itens repetidos',
    repetidos.length === 0,
    repetidos.length > 0 ? repetidos.join(' ') : 'nenhum',
  );
  checar(
    'proveniência gravada',
    Boolean(craft?.key),
    craft ? `${craft.key} v${craft.currentVersion}` : 'sem playbook',
  );

  // --- o Lab: o produto final ---------------------------------------------
  const cenario =
    'Plataforma que conecta prestadores de serviço a clientes. O usuário veio de um anúncio.';
  const turnos = ['pode me chamar de Lucas', 'como funciona?', 'e quanto custa?', 'tenho receio'];
  const historico: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const tempos: number[] = [];
  let vazias = 0;
  let erros = 0;

  for (const message of turnos) {
    const turno = Date.now();
    const res = await call(`/api/agents/${agente.id}/test`, {
      method: 'POST',
      body: JSON.stringify({ message, scenario: cenario, history: historico.slice(-10) }),
    });
    tempos.push(Date.now() - turno);

    if (res.status !== 200) {
      erros += 1;
      continue;
    }

    const reply = String(res.body['reply'] ?? '');
    // Resposta vazia conta como falha: um agente mudo é pior que um erro para
    // quem está justamente testando se ele responde.
    if (!reply.trim()) vazias += 1;
    historico.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
  }

  const ordenados = [...tempos].sort((a, b) => a - b);
  checar(
    'conversa no Lab',
    erros === 0 && vazias === 0,
    `${erros} erros · ${vazias} vazias · mediana ${ordenados[Math.floor(ordenados.length / 2)]}ms`,
  );

  // --- ajuste pelo OS: o caminho que o usuário mais repete -----------------
  const conversaAgente = await call('/api/hub/conversations', {
    method: 'POST',
    body: JSON.stringify({ scope: 'AGENT', scopeId: agente.id }),
  });
  // Pedido VAGO de propósito, com o TRANSCRITO junto: é assim que o usuário
  // pede de verdade — "isso aí está errado" — e o OS precisa achar o quê
  // lendo a conversa, em vez de exigir que ele narre o diálogo.
  const ajuste = await call(
    `/api/hub/conversations/${String(conversaAgente.body['id'])}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        content: 'A última pergunta dele está errada. Corrige.',
        testTranscript: [
          { role: 'user', content: 'Opa! É Lucas' },
          { role: 'assistant', content: 'Prazer! Com que tipo de serviço você trabalha?' },
          { role: 'user', content: 'Trampo fixo como FullStack em consultoria' },
          {
            role: 'assistant',
            content: 'Entendi. E além do fixo, você costuma pegar trampos por fora?',
          },
        ],
      }),
    },
  );
  const opAjuste = ajuste.body['operation'] as { id?: string } | undefined;

  if (!opAjuste?.id) {
    checar('ajuste pelo OS', false, String(ajuste.status));
  } else {
    const statusAjuste = await aguardar(opAjuste.id, 240_000);
    checar(
      'ajuste pelo OS',
      statusAjuste === 'COMPLETED',
      `${Date.now() - at}ms · ${statusAjuste}`,
    );

    const depois = await call(`/api/agents/${agente.id}`);
    const conf = depois.body['configuration'] as
      { canonical: Record<string, unknown>; versionNumber: number } | undefined;

    // O ajuste não pode gravar o CASO. "freelance" e "trabalho avulso" nomeiam
    // arranjos e são legítimos — é o tipo de concretude que a regra precisa ter.
    // A ocupação e o empregador DAQUELE interlocutor não são: ficariam
    // pendurados em toda conversa futura, com todo cliente.
    const caso = /full.?stack|consultoria|hospital|transportadora|enfermeir/i;
    const vazados = FACETAS.flatMap(
      (faceta) => (conf?.canonical[faceta] ?? []) as Array<{ code: string; statement: string }>,
    ).filter((item) => caso.test(item.statement));

    checar(
      'não gravou o caso de teste',
      vazados.length === 0,
      vazados.length > 0 ? vazados.map((item) => item.code).join(' ') : 'limpo',
    );

    checar(
      'não inflou a configuração',
      contarItens(conf?.canonical) - itens <= 3,
      `${itens} → ${contarItens(conf?.canonical)} itens`,
    );
  }

  console.log('');
  if (falhas.length > 0) {
    console.log(`FALHOU em: ${falhas.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('jornada completa, ponta a ponta.');
  }
}

await main();
