import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { createContainer } from '../container.js';
import type {
  AccountInventory,
  AccountInventoryReader,
} from '../modules/myaihub/application/account-inventory.js';
import { RouteHubRequestUseCase } from '../modules/myaihub/application/route-request.use-case.js';
import type { TenantContext } from '../shared/application/tenant-context.js';

/**
 * REGRESSÃO DO ROTEAMENTO, contra o modelo real.
 *
 *   npm run smoke:routing
 *
 * O roteador decide o que TODA mensagem do painel vira, e a suíte não o
 * alcança: ela roda contra o FakeProvider, que devolve o que o teste manda. As
 * regressões dele só apareciam no uso — a última foi "crie um projeto a partir
 * deste link" numa conta vazia virar "não identifiquei qual projeto", porque o
 * roteador escolheu CADASTRAR O LINK no conhecimento de um projeto que não
 * existia.
 *
 * Cada caso fixa o INVENTÁRIO (conta vazia ou populada) e a tela, e declara o
 * que o S.O tem que escolher. Nada é executado: só a decisão. Rode ao mexer na
 * instrução do roteador, no `purpose` de uma operação, no catálogo de ações ou
 * no inventário — e leia o resultado antes de dizer que está pronto.
 */

const VAZIA: AccountInventory = {
  projects: [],
  agents: [],
  campaigns: [],
  playbooks: [{ id: 'sales.consultive', name: 'Venda consultiva', detail: 'ofício da plataforma' }],
  knowledge: [],
};

const P = '01SMKPROJ0000000000000000A';
const C = '01SMKCAMP0000000000000000A';
const A = '01SMKAGEN0000000000000000A';

const POPULADA: AccountInventory = {
  projects: [{ id: P, name: 'Sankar', detail: 'projeto ativo' }],
  agents: [{ id: A, name: 'Alex', detail: 'Representante Comercial Estratégico' }],
  campaigns: [
    {
      id: C,
      name: 'Linha Industrial Sankar',
      detail: 'DRAFT, do projeto Sankar, SEM agente vinculado',
      parentId: P,
    },
  ],
  playbooks: VAZIA.playbooks,
  knowledge: [],
};

interface Caso {
  nome: string;
  conta: AccountInventory;
  scope: string;
  scopeId?: string;
  /** Ação da tela oferecida — o painel manda como pista. */
  suggested?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * Nome da operação ou ação esperada; `QUESTION` quando o certo é perguntar.
   * Lista quando mais de uma é defensável — o que importa ali é o desfecho,
   * validado no caminho real.
   */
  espera: string | string[];
  alvo?: string;
}

const CASOS: Caso[] = [
  {
    nome: 'conta vazia: criar projeto a partir do site',
    conta: VAZIA,
    scope: 'ROOT',
    suggested: 'project.create_from_brief',
    message:
      'Crie um projeto a partir do portal da empresa. Acesse neste link:\nhttps://www.sankar.com.br/home',
    espera: 'project.create_from_brief',
  },
  {
    nome: 'conta vazia: criar projeto SEM pista da tela',
    conta: VAZIA,
    scope: 'ROOT',
    message: 'Crie um projeto a partir do site https://www.sankar.com.br/home',
    espera: 'project.create_from_brief',
  },
  {
    nome: 'conta vazia: criar agente',
    conta: VAZIA,
    scope: 'ROOT',
    message: 'cria um agente representante comercial pra mim',
    espera: 'agent.create',
  },
  {
    nome: 'conta populada: outro projeto a partir de site',
    conta: POPULADA,
    scope: 'PROJECT',
    scopeId: P,
    message: 'Crie outro projeto a partir do site https://acme.com.br',
    espera: 'project.create_from_brief',
  },
  {
    nome: 'site no conhecimento do projeto existente',
    conta: POPULADA,
    scope: 'PROJECT',
    scopeId: P,
    message: 'adiciona https://www.sankar.com.br/produtos no conhecimento desse projeto',
    espera: 'knowledge.add_url',
    alvo: P,
  },
  {
    nome: 'informação nova do negócio',
    conta: POPULADA,
    scope: 'PROJECT',
    scopeId: P,
    message: 'a gente também atende indústria farmacêutica',
    espera: 'project.refine_profile',
    alvo: P,
  },
  {
    nome: 'criar campanha no projeto',
    conta: POPULADA,
    scope: 'ROOT',
    message: 'cria uma campanha de estamparia no Sankar',
    espera: 'campaign.create',
    alvo: P,
  },
  {
    nome: 'vincular pela tela da campanha',
    conta: POPULADA,
    scope: 'CAMPAIGN',
    scopeId: C,
    message: 'Vincule o agente criado aqui no projeto',
    espera: 'campaign.bind_agent',
    alvo: C,
  },
  {
    nome: 'resposta curta à pergunta anterior',
    conta: POPULADA,
    scope: 'CAMPAIGN',
    scopeId: C,
    message: 'O único que tem',
    history: [
      { role: 'user', content: 'Vincule o agente criado aqui no projeto' },
      { role: 'assistant', content: 'Qual agente você quer vincular?' },
    ],
    espera: 'campaign.bind_agent',
  },
  {
    nome: 'cortesia testando a campanha → base do agente',
    conta: POPULADA,
    scope: 'CAMPAIGN',
    scopeId: C,
    message:
      'Precisa ajustar essa saudação, ele não pergunta como o usuário está e nem como pode chamá-lo',
    espera: 'agent.configure',
    alvo: A,
  },
  {
    nome: 'público da campanha',
    conta: POPULADA,
    scope: 'CAMPAIGN',
    scopeId: C,
    message: 'o público dessa campanha são engenheiros de manutenção',
    espera: 'campaign.refine_strategy',
    alvo: C,
  },
  {
    nome: 'publicar',
    conta: POPULADA,
    scope: 'ROOT',
    message: 'publica a campanha da linha industrial',
    espera: 'campaign.publish',
  },
  {
    nome: 'excluir pede confirmação',
    conta: POPULADA,
    scope: 'ROOT',
    message: 'exclui o Alex',
    espera: 'QUESTION',
  },
  {
    nome: 'algo que o sistema não faz, na tela do agente',
    conta: POPULADA,
    scope: 'AGENT',
    scopeId: A,
    message:
      'Quero que ao final da conversa ele mande automaticamente o orçamento por e-mail para o cliente',
    // Conduta de conversão é da campanha; o que não pode é virar pergunta sem
    // resposta nem uma operação que finja ter feito — cada uma registra o limite.
    espera: ['agent.configure', 'campaign.refine_strategy', 'campaign.configure_cta'],
  },
  {
    nome: 'relato de erro com conversa de teste',
    conta: POPULADA,
    scope: 'AGENT',
    scopeId: A,
    message:
      'O agente acertou em querer que o usuário seja específico, porém errou em não identificar o que o usuário já deixou claro: "Preciso de um novo ferramental". Entendeu?',
    // Duas leituras legítimas: conduta do agente (não leu o que foi declarado)
    // ou escopo da oferta da campanha (a empresa não faz ferramental).
    espera: ['agent.configure', 'campaign.refine_strategy'],
  },
  {
    nome: 'pergunta sobre o agente',
    conta: POPULADA,
    scope: 'AGENT',
    scopeId: A,
    message: 'qual a diferença entre ele e um SDR?',
    espera: 'agent.configure',
    alvo: A,
  },
];

async function main(): Promise<void> {
  if (!env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY não configurada.');
    process.exitCode = 1;
    return;
  }

  // O custo vai para `ai_calls` de uma conta real — a do admin semeado. Leitura
  // crua, fora do guard: é a única consulta do script, e só pega o id.
  const prisma = new PrismaClient();
  const conta = await prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
  await prisma.$disconnect();
  if (!conta) {
    console.error('Nenhuma conta no banco. Rode npm run db:seed.');
    process.exitCode = 1;
    return;
  }

  const context: TenantContext = {
    accountId: conta.id,
    userId: null,
    role: 'ADMIN',
    membershipRole: 'OWNER',
    elevated: false,
  };
  const { ai } = createContainer();
  const rodadas = Number(process.env['SMOKE_ROUNDS'] ?? 2);

  let falhas = 0;
  let tokens = 0;

  // SMOKE_ONLY="trecho do nome" repete só os casos que interessam — para medir
  // estabilidade de um caso instável sem pagar a suíte inteira.
  const filtro = process.env['SMOKE_ONLY'];
  const casos = filtro ? CASOS.filter((caso) => caso.nome.includes(filtro)) : CASOS;

  for (const caso of casos) {
    const inventario = {
      read: () => Promise.resolve(caso.conta),
    } as unknown as AccountInventoryReader;
    const router = new RouteHubRequestUseCase({ gateway: ai.gateway, inventory: inventario });

    for (let rodada = 1; rodada <= rodadas; rodada += 1) {
      const routed = await router.execute(context, {
        scope: caso.scope,
        ...(caso.scopeId ? { scopeId: caso.scopeId } : {}),
        ...(caso.suggested ? { suggested: caso.suggested } : {}),
        message: caso.message,
        ...(caso.history ? { history: caso.history } : {}),
      });
      tokens += routed.totalTokens;

      const escolha = routed.action?.spec.name ?? routed.operation?.name ?? 'QUESTION';
      const alvo = routed.action?.args.targetId ?? routed.targetId;
      const esperadas = Array.isArray(caso.espera) ? caso.espera : [caso.espera];
      const ok = esperadas.includes(escolha) && (!caso.alvo || alvo === caso.alvo);
      if (!ok) falhas += 1;

      console.log(
        `${ok ? '✓' : '✗'} ${caso.nome} [${rodada}] → ${escolha}` +
          (alvo ? ` @${alvo === P ? 'P' : alvo === C ? 'C' : alvo === A ? 'A' : alvo}` : '') +
          (routed.question ? ` — "${routed.question}"` : '') +
          ` (${routed.totalTokens} tokens)`,
      );
    }
  }

  const total = casos.length * rodadas;
  console.log(`\n${total - falhas}/${total} corretos · ${tokens} tokens no total`);
  if (falhas > 0) process.exitCode = 1;
  process.exit();
}

void main();
