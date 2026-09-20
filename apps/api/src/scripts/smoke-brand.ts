/**
 * A IDENTIDADE VISUAL, do site até a página publicada — contra o Gemini REAL.
 *
 *   npm run smoke:brand
 *
 * Cobre o que `verify:full` não alcança: a suíte roda contra o `FakeProvider`,
 * que devolve o que o teste mandar. Aqui o que se mede é se o modelo LÊ a
 * medição do site e escolhe direito — a cor da marca e não o azul do Bootstrap,
 * a fonte do texto e não a de ícone.
 *
 * A checagem central não é "preencheu os campos": é que a identidade DEIXOU de
 * ser o padrão do MyAIHub. Um projeto criado a partir do site do cliente com
 * `#1f6feb` gravado é exatamente o defeito que isto existe para pegar.
 *
 * Precisa da API no ar, de `SMOKE_PASSWORD` e de rede até o site alvo.
 */
import 'dotenv/config';

const API = process.env['SMOKE_API_URL'] ?? 'http://localhost:3333';
const EMAIL = process.env['SMOKE_EMAIL'] ?? 'admin@myaihub.local';
const PASSWORD = process.env['SMOKE_PASSWORD'];
const SITE = process.env['SMOKE_SITE'] ?? 'https://www.sankar.com.br/home';

/** O default do sistema. A marca extraída NÃO pode terminar aqui. */
const PADRAO = { primary: '#1f6feb', canvas: '#f7f8fb', surface: '#ffffff' };

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

const falhas: string[] = [];

function checar(etapa: string, ok: boolean, detalhe: string): void {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${etapa.padEnd(28)} ${detalhe}`);
  if (!ok) falhas.push(etapa);
}

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
          code?: string;
          message?: string;
        };

        // O aviso de captura conta o que o S.O achou — é o que se lê quando a
        // cor sai errada e alguém precisa saber de onde ela veio.
        if (evento.code === 'BRAND_CAPTURED' || evento.code === 'SOURCE_READ') {
          console.log(`     · ${evento.message ?? ''}`);
        }

        if (evento.type !== 'operation.completed') continue;
        return evento.status === 'completed' ? 'COMPLETED' : `FAILED: ${evento.errorCode ?? '?'}`;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (!PASSWORD) {
    console.error('Defina SMOKE_PASSWORD.');
    process.exitCode = 1;
    return;
  }

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  checar('login', login.status === 200, String(login.status));
  if (login.status !== 200) {
    process.exitCode = 1;
    return;
  }

  const conversa = await call('/api/hub/conversations', {
    method: 'POST',
    body: JSON.stringify({ scope: 'ROOT' }),
  });
  checar('conversa do painel', conversa.status === 201, String(conversa.status));

  const inicio = Date.now();
  const disparo = await call(`/api/hub/conversations/${String(conversa.body['id'])}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: `Crie um projeto a partir do portal da empresa. Acesse neste link: ${SITE}`,
    }),
  });

  const operacao = disparo.body['operation'] as { id?: string } | undefined;
  checar('operação disparada', Boolean(operacao?.id), String(disparo.status));
  if (!operacao?.id) {
    process.exitCode = 1;
    return;
  }

  const desfecho = await aguardar(operacao.id, 240_000);
  checar('criação concluída', desfecho === 'COMPLETED', `${desfecho} · ${Date.now() - inicio}ms`);

  const projetos = await call('/api/projects');
  const lista = (projetos.body as { items?: Array<{ id: string; name: string }> }).items ?? [];
  const projeto = lista[0];
  checar('projeto na lista', Boolean(projeto), projeto?.name ?? 'nenhum');
  if (!projeto) {
    process.exitCode = 1;
    return;
  }

  const marca = await call(`/api/projects/${projeto.id}/brand`);
  const canonical = (
    marca.body as {
      canonical?: {
        colors?: Record<string, string>;
        typography?: { headingFamily: string; bodyFamily: string; source: string };
        shape?: string;
        tagline?: string;
      };
      versionNumber?: number;
    }
  ).canonical;

  const cores = canonical?.colors ?? {};
  const tipografia = canonical?.typography;

  console.log();
  console.log('Paleta   :', JSON.stringify(cores));
  console.log('Tipografia:', JSON.stringify(tipografia));
  console.log('Forma    :', canonical?.shape, '· tagline:', canonical?.tagline || '(vazia)');
  console.log();

  // A checagem que importa: a identidade deixou de ser a do MyAIHub.
  checar(
    'cor da marca veio do site',
    Boolean(cores['primary']) && cores['primary'] !== PADRAO.primary,
    `${cores['primary']} (padrão era ${PADRAO.primary})`,
  );

  checar(
    'paleta inteira preenchida',
    Boolean(cores['canvas'] && cores['surface'] && cores['text'] && cores['border']),
    `canvas ${cores['canvas']} · surface ${cores['surface']} · text ${cores['text']}`,
  );

  checar(
    'tipografia do site',
    Boolean(tipografia && (tipografia.bodyFamily || tipografia.headingFamily)),
    tipografia ? `${tipografia.headingFamily || '—'} / ${tipografia.bodyFamily || '—'}` : 'ausente',
  );

  // Fonte declarada como GOOGLE sem família é um `<link>` para lugar nenhum.
  checar(
    'fonte coerente com a origem',
    tipografia?.source !== 'GOOGLE' || Boolean(tipografia.bodyFamily || tipografia.headingFamily),
    `source=${tipografia?.source ?? '?'}`,
  );

  console.log();
  if (falhas.length > 0) {
    console.error(`FALHOU em: ${falhas.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Identidade visual extraída do site e gravada.');
}

void main();
