# MyAIHub — instruções do projeto

Hub de operações com IA. O usuário administra **intenção**; o MyAIHub administra **a
implementação técnica da IA**. Primeiro módulo operacional: **Campanhas**.

**Arquitetura, decisões e riscos:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Leia antes de mexer em estrutura, modelagem ou fluxo. Ele é a fonte de verdade —
se o código divergir dele, um dos dois está errado e isso precisa ser resolvido,
não ignorado.

**O painel — escopo, decisões de UX e o que falta:** [`docs/PANEL.md`](docs/PANEL.md).
Leia antes de mexer no `HubPanel`, nas quick actions ou no que o painel exibe.

**Mapa de código gerado** (arquivos, módulos, fluxo de dados, gotchas por
arquivo): [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md). Navegação, não fonte
de verdade — diverge dele, ARCHITECTURE.md vence.

---

## Ambiente desta máquina

O disco **C: vive perto do limite**. O Prisma e o npm quebram com "espaço insuficiente"
mesmo tendo o projeto em L:.

```bash
# SEMPRE antes de npm/prisma/vitest, se TEMP não estiver configurado no ambiente:
$env:TEMP='L:\.npm-tmp'; $env:TMP='L:\.npm-tmp'
```

`.claude/settings.json` já injeta isso automaticamente. Se um comando falhar com
`os error 112` ou `ENOSPC`, é isto.

**SUBIR A APLICAÇÃO É UM COMANDO SÓ: `npm run dev`.** Ele garante a infra
(`compose up -d --wait`) e sobe api e web; o BOOT da API aplica migração
pendente e semeia. Verificado com o volume do MySQL DESTRUÍDO: um comando,
e o login responde 200.

Antes, `docker:up` deixava o banco pronto e a aplicação continuava fora do
ar — e a tela dizia "não foi possível falar com a API" para quem tinha
acabado de subir tudo o que sabia subir. Ordem para decorar é ritual, e
ritual pertence ao código.

`docker:up` continua existindo para quando você quer só o banco pronto: ele
espera ficar saudável, migra e semeia. `docker:up:only` sobe os containers
sem tocar no banco.

O custo do passo de infra no `dev` é 1,4s com tudo já no ar — medido. Em
troca, não existe estado em que a aplicação sobe contra um banco
desatualizado esperando alguém lembrar de um comando.

Consequência: `npm run dev` exige o Docker no ar. Para apontar a API a um
banco que não é o do compose, use `dev:api` e `dev:web` direto.

O boot detecta migração PENDENTE, não só schema ausente. A checagem antiga
consultava uma tabela da PRIMEIRA migração: com o schema existente ela dizia
"tudo certo", a migração nova ficava para trás, e a API quebrava depois — na
primeira query que tocasse a coluna nova, longe da causa. Agora ela cruza as
pastas de `prisma/migrations` com `_prisma_migrations`.

Em PRODUÇÃO nada disso é automático: migração é passo de deploy (subir réplica
não pode alterar banco) e seed criaria admin com senha conhecida. Lá o boot só
VERIFICA e se recusa a subir com o schema errado.

O disco de dados do Docker foi movido para `L:\DockerData`. Não reverta.

---

## Comandos

| Comando | Nota |
|---|---|
| `npm run dev` | **sobe tudo**: infra, migrações, seed, api (3333) e web (5173) |
| `npm run typecheck` | `tsc -b` + o projeto de teste. **Roda os dois** |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run verify` | lint + typecheck + **unit** + build. **~35s** — é o laço de trabalho |
| `npm run verify:full` | o mesmo com integração. ~5min. Antes de declarar pronto |
| `npm run smoke:journey` | a jornada REAL contra o Gemini. **Obrigatório** ao mexer em provider, prompt ou schema |
| `npm run smoke:routing` | o ROTEADOR contra o Gemini real: frases fixas × inventário fixo × escolha esperada, 2 rodadas. **Obrigatório** ao mexer na instrução do roteador, em `purpose`, no catálogo de ações ou no inventário. `SMOKE_ONLY="trecho"` repete um caso |
| `npm run smoke:brand` | a IDENTIDADE VISUAL contra o Gemini real: site → varredura → marca gravada. Falha se a identidade continuar no padrão do MyAIHub. `SMOKE_SITE` troca o alvo |
| `npm run scan:site <url>` | só a varredura, SEM modelo — separa "a extração não achou" de "o modelo leu errado" |
| `npm test` | Vitest, todos os workspaces (inclui integração) |
| `npm run e2e` | Playwright, contra o build servido. Banco e provider PRÓPRIOS |
| `npm run e2e:setup` | migra + semeia o banco do E2E. **Rode uma vez antes do `e2e`** |
| `npm run test:unit` | só unitários — 273 testes em ~10s |
| `npm run docker:up` | MySQL + Adminer, **espera ficar saudável, migra e semeia** |
| `npm run docker:up:only` | só os containers, sem tocar o banco |
| `npm run db:migrate` | `migrate dev` (usa `myaihub_shadow`) |
| `npm run db:seed` | recria admin + usuário teste |
| `npm run db:setup` | migrate + seed, avulso |

**`verify:full` VERDE NÃO SIGNIFICA QUE FUNCIONA.** A suíte roda contra o
`FakeProvider` — invariante 8, e ela não se negocia. O que o Fake não reproduz
é o provider de verdade, e foi ali que TODAS as últimas regressões moraram:
raciocínio que atrasa a primeira palavra, stream que abre e não escreve, stream
que começa e para no meio. Nenhuma apareceria em teste nenhum desta suíte, e
todas chegaram ao usuário.

`npm run smoke:journey` cobre o que ela estruturalmente não alcança: briefing →
criar agente → conversar no Lab → ajustar pelo OS, contra o Gemini real, pelo
mesmo HTTP do browser. Precisa da API no ar e de `SMOKE_PASSWORD`. Rode ao
mexer em provider, prompt, schema de saída ou instrução de operação — e leia o
resultado antes de dizer que está pronto.

Antes de declarar qualquer coisa pronta: **`verify:full`** (os quatro, com integração).
Durante o trabalho, **`verify`** — os mesmos quatro sem o banco, em ~35s.

Onde vai o tempo, medido: lint 11s · typecheck 6s · build 9s · unitários 10s ·
**integração 250s**. Os testes de integração dominam porque cada operação do OS
faz ~20 escritas sequenciais (evento persistido um a um, para o replay do SSE) e
o MySQL está em Docker num disco mecânico. Não é gordura: é o custo real. Rodar
a suíte inteira a cada edição é que era o erro.

**`dev:api` chama o `tsx` direto, não `npm run -w`.** Duas camadas de npm custavam
~650ms em todo start e restart — mais que o boot inteiro da aplicação. Não
"padronize" de volta para `npm run dev -w @myaihub/api`. O `dev:web` continua
via workspace de propósito: o `vite.config.ts` resolve o `.env` por caminho
relativo ao CWD e quebra se rodar da raiz.

---

## SEMPRE SEGUIR O PADRÃO

Antes de escrever qualquer coisa: **procure como o projeto já faz isso**. Se
existe um jeito, use o jeito. Um segundo caminho para a mesma coisa é o começo
de dois comportamentos diferentes para a mesma coisa — e o segundo nunca recebe
as correções que o primeiro recebeu.

Isto não é preferência de estilo. Cada vez que a regra foi quebrada aqui, ela
cobrou:

- **Uma porta própria para o OS.** A calibração do playbook nasceu com caixa de
  texto na tela e endpoint próprio. Resultado: outro formato de saída, outro
  tratamento de erro, e o modelo reescrevendo o documento inteiro em vez de usar
  mutação tipada — que é como TODO o resto do sistema altera configuração.
- **Tipo duplicado nos dois lados.** `HubScope` estava copiado no frontend; a
  cópia ficou para trás quando `PLAYBOOK` entrou. `AgentPlaybook` também estava
  duplicado, e o schema mudou só de um lado. O sintoma é sempre a tela dizer
  "salvo" enquanto a API devolve 422.
- **Seção como rolagem em vez de rota.** A tela do playbook virou um formulário
  de dois mil pixels sem nível de sidebar, quando o agente já tinha resolvido
  isso com uma rota por faceta.
- **Botão de chamar o OS espalhado.** Um no cabeçalho, uma caixa embutida na
  tela do playbook. Existe UMA porta: o botão flutuante, que abre o painel no
  escopo da rota atual.

Quando o padrão existente REALMENTE não serve, diga por que antes de inventar
outro — e se a resposta for "porque é mais rápido", não serve.

Onde procurar o padrão, por assunto:

| Vai fazer | Copie de |
|---|---|
| Alterar configuração pelo OS | `CanonicalMutation` + `OperationTarget` + runner |
| Conversar com o OS numa tela nova | `resolveHubContext` (escopo por rota) + painel |
| Documento versionado | `HubPolicy` / `Playbook`: semente aditiva, versão imutável |
| Seção longa numa tela | rota por seção + nível na sidebar (facetas do agente) |
| Tipo que atravessa API e web | `packages/shared` — nunca declarar dos dois lados |
| Item de configuração | `code` + `semanticKey` + `label` + `statement` |

---

## A regra que governa toda rodada

**QUANDO O S.O NÃO FOR CAPAZ DE RESOLVER UM PROBLEMA, CORRIJA O CORE DO S.O —
NUNCA RESOLVA O PROBLEMA NO LUGAR DELE.**

Vale para tudo: princípio de playbook, item de agente, seção de perfil,
semente, canônico. Se a saída correta existe mas o S.O não chegou nela
sozinho, o defeito é DELE — não do artefato.

A pergunta certa nunca é "qual é a resposta?", e sim **"o que falta para ele
conseguir?"**: mutação que não existe, escopo que ele não alcança, contexto
que ele não enxerga, orientação ausente na Master Policy. É isso que se
implementa, e é isso que fica no commit — não o conserto manual.

Tocar o artefato à mão só vale para VERIFICAR a hipótese. Depois, provar pelo
caminho real que agora ele resolve sozinho.

O custo de ignorar isto está medido neste repositório: nove versões seguidas
de `sales.consultive` (v6→v14) tentando a mesma correção, cada uma parecendo
um ajuste, nenhuma mudando o comportamento — porque o que faltava eram quatro
capacidades ESTRUTURAIS do S.O, e não uma redação melhor.

---

## Invariantes que não se negocia

Estas quebram o build de propósito. Se uma delas atrapalhar, o problema é o código,
não a regra.

1. **Tenant scoping.** `TenantContext` explícito nos use cases **e** o guard
   fail-closed do Prisma. Todo modelo novo precisa ser classificado em
   `tenant-policy.ts` — sem isso os testes ficam vermelhos.
   `findUnique({ where: { id } })` em modelo tenant-scoped é **rejeitado**: use
   `findFirst({ where: { id, accountId } })`. É o que fecha IDOR.
2. **Camadas.** `domain/` e `application/` não importam Prisma, Express nem SDK de
   provider. Sempre por port.
3. **Raw SQL** (`$queryRaw`) é barrado por lint — escapa do tenant guard.
4. **Banco é a fonte da verdade.** Prompt é artefato efêmero. Nada de estado em
   arquivo (`session.json`, `strategy.md`); uploads são `MediaAsset`.
5. **Versionamento + auditoria + ponteiro de versão na MESMA transação.**
6. **A LLM propõe, o domínio valida e aplica.** Nunca JSON Patch livre do modelo —
   só `CanonicalMutation` tipada dentro do `allowedMutations` da operação.
7. **Publicação é imutável.** Alterar Agent/Project/Campaign não muda o que está no
   ar; exige novo `CampaignPublicDeployment`.
8. **Nenhum teste consome API paga.** `FakeProvider` é permanente, não andaime.

---

## Convenções

- **Português** em comentários, mensagens de erro, UI e nomes de teste. Código
  (identificadores, tipos) em inglês.
- Comentário explica **por quê**, não o quê. Se descreve o que a linha faz, apague.
- Módulo do backend: `domain/` · `application/` · `infrastructure/` · `presentation/`.
  Não crie pasta vazia "para seguir o padrão".
- Imports relativos: **`.js` no backend** (NodeNext), **sem extensão no frontend**
  (bundler). Trocar isso quebra em runtime, não no typecheck.
- Fixtures de teste: `*.fixtures.ts` (excluídos do build).
- Erro de API: sempre `AppError` com `ErrorCode` do `@myaihub/shared`.
  `throw new Error(...)` numa borda vira 500 — quase sempre é o status errado.

---

## Otimização de contexto

Utilize o Headroom quando as saídas de ferramentas forem extensas, repetitivas ou predominantemente diagnósticas —
especialmente logs, saídas de testes, resultados de grep/busca, JSON e respostas de API.

Não comprima código-fonte crítico, contratos de arquitetura ou saídas pequenas
quando a representação original for importante para a correção.

Utilize `headroom_retrieve` sempre que detalhes omitidos pela compressão se tornarem necessários.

---

## Testes

- **Unitários** (`src/**/*.test.ts`): decisão e regra, com dublês. Sem banco.
- **Integração** (`tests/**`): banco real, `myaihub_test`, **truncado a cada teste**.
  O reset vai num `$transaction` ÚNICO com todos os `deleteMany`. A versão com
  `await` por modelo custava ~28 viagens ao banco por teste (~1.600 na suíte) e
  respondia por 100s do tempo total. Não volte para o laço sequencial.
- Sem Docker no ar os testes de integração **pulam com aviso**; em **CI são
  obrigatórios** (`CI=true` faz o globalSetup falhar em vez de pular).
- O projeto da API roda em `singleFork`: os arquivos de integração compartilham um
  banco e em paralelo causam deadlock e truncate cruzado. Não remova.
- Dublê tem que ser **fiel ao contrato** (mesmos erros, mesmo relógio). Dublê
  otimista transforma 500 em teste verde.

---

## Estado atual

**Todas as fases (0–11) concluídas**, verificadas contra o Gemini real pelo mesmo
caminho HTTP do browser: marca salva e congelada na publicação, conhecimento
indexado e recuperado (o agente respondeu A PARTIR dele, no Lab e no chat
público), conversa persistindo entre turnos nos dois canais, e o dashboard
contando a conversa pública com o custo — sem contar a do Lab.

O perfil do projeto está na **v2** do canônico (`market` + `businessRules`), com
seção por rota, Lab pelo projeto e `project.organize_workspace`.

**O runner manda o HISTÓRICO da conversa, não só a última fala.** Sem isso cada
ajuste era cego: o OS não sabia que o usuário já tinha reclamado da mesma coisa,
e repetia uma correção tímida por rodada. Medido: uma persona levava 4 turnos
para convergir. Com histórico + instrução de escalonamento (1ª refina, 2ª sobe
para HARD, 3ª procura e remove a CAUSA), converge em 3 e o `enforcement` sobe.

**O schema do OS NUNCA cabe no teto do Gemini** — a união de mutações canônicas
sozinha estoura. Toda operação do OS roda em JSON mode, com o schema descrito no
texto: a decodificação não é restrita e o modelo pode omitir campo obrigatório.
Simplificar o contrato para caber seria deixar a ferramenta ditar o domínio; a
defesa correta é outra, em três camadas:

1. contrato repetido no FIM da instrução ("ANTES DE RESPONDER, CONFIRA");
2. UMA correção automática no gateway, listando os campos exatos que faltaram
   (`schemaCorrection`) — o modelo errou a FORMA, não o conteúdo, e refazer o
   raciocínio inteiro desperdiça o que já foi pago;
3. até 3 tentativas para 503/429 no adapter. O teto de "1 retry" da arquitetura
   existe por CUSTO, e falha transitória não consome token nenhum.

**Geração estruturada tem timeout PRÓPRIO (180s), separado do de conversa (30s).**
Criar um agente produz ~8.500 tokens de saída e passava de 60s com frequência —
o teto de turno de chat derrubava operações que estavam certas. Medido: 3/5 de
sucesso antes, 5/5 depois. O de conversa é 30s porque um turno saudável leva
~1,5s (pior caso saudável 5s): depois disso não existe resposta boa, só espera,
e refazer o turno custa ao usuário uma tecla.

**Instrução longa esconde o contrato de saída.** A instrução de criar agente tem
~7.700 caracteres e o schema NÃO cabe no teto do Gemini (degrada para JSON mode,
com o schema descrito no texto). O modelo passou a omitir `identity`/`objective`
porque eles eram citados no começo e soterrados. A correção é repetir o contrato
no FIM ("ANTES DE RESPONDER, CONFIRA") — o que vem por último é o que ele retém.
Ao acrescentar campo na saída, verifique `fitsGeminiSchemaLimits`.

**O contrato de saída tem que ser a ÚLTIMA coisa da instrução.** Acrescentei
uma checagem de cobertura depois dele e a taxa de `STRUCTURED_OUTPUT_INVALID`
disparou: o modelo passou a omitir `identity` e `objective` de novo. Custo
medido de UM turno assim: 107s recusados + 137s de correção = 273s de espera
para o usuário. Movida a checagem para ANTES do contrato, a mesma criação levou
13s. Qualquer coisa nova entra antes de "ANTES DE RESPONDER, CONFIRA", nunca
depois.

Só consegui diagnosticar porque o trace passou a guardar a mensagem e os
detalhes do erro do provider — antes, `INVALID_OUTPUT` no banco não dizia
QUAL campo faltou.

**Limite de campo apertado custa caro.** `plan` aceitava 80 caracteres; o
modelo escrevia 85 e a saída INTEIRA era recusada, pagando um turno de correção
de dois minutos por um rótulo de checklist. Passou para 120. Antes de apertar um
limite, pergunte o que ele custa quando o modelo erra por pouco.

**O checklist do painel vem do MODELO**, não é fixo. O campo `plan` viaja na
mesma resposta em que o trabalho é feito — custo zero — e o painel troca os três
rótulos genéricos pelos passos reais daquele pedido.

**Sessão de 15 min só em produção.** Em dev o default é 12h: a sessão morria no
meio de um teste do Lab e aparecia como "Autenticação necessária", longe da causa.

**O OS DERIVA a baseline profissional do agente.** Pedir "Representante Comercial
Estratégico" tem que produzir personalidade, comunicação, skills, comportamentos,
estratégias e limites — não só o objetivo. A instrução antiga mandava o contrário
("NÃO invente personalidade... registre em `gaps`") e era a causa raiz de
agentes nascendo com sete facetas vazias.

A linha que separa: **FATO DO NEGÓCIO** (preço, prazo, produto, região) só o
usuário sabe → vira pergunta. **OFÍCIO** (como um profissional daquele papel
trabalha) é engenharia de prompt → deriva sempre. Perguntar ofício devolve ao
usuário o trabalho que ele veio delegar.

**Expandir é aprofundar UM item, não multiplicar itens.** "Seja objetivo" vira um
`communication.objectivity` cujo `statement` já contém: sem preâmbulo, resposta
curta, direto antes de contextualizar, sem repetição, aprofunda só se pedirem.

**`MYAIHUB_BASELINE` é source distinta de `MYAIHUB`.** Baseline inferida não é
intenção explícita; quando o usuário depois contradiz, a intenção dele vence — e
só dá para reconciliar se a origem estiver gravada. O item carrega `rationale`
dizendo por que o OS o inferiu.

**`guardAgainstRegression` garante em CÓDIGO que refinar nunca perde.** Item que
sumiria sem remoção pedida volta; `statement` que encolheu >15% é restaurado;
enforcement rebaixado sem pedido é desfeito. Restaura e avisa, não recusa —
recusar perderia também o que veio de bom no mesmo turno.

**Sem template por profissão.** Nada de `if (role === 'vendedor')`. A baseline
sai das Operations tipadas, pelo mesmo pipeline de sempre.

**Mas o OFÍCIO vem de PLAYBOOK, não do que o modelo por acaso souber.** Isto não
contradiz a regra acima: o playbook entra como CONTEXTO, e quem escreve os itens
continua sendo o modelo, pelas mesmas mutações tipadas. O que mudou é o piso.
Perguntar a um `flash-lite` como trabalha um "representante comercial
estratégico" devolve platitude — medido: o agente nascia empurrando produto no
primeiro turno e o usuário corrigia à mão o que o sistema deveria saber.

`Playbook`/`PlaybookVersion` seguem a Master Policy à risca: globais à
plataforma, versionados, semeados aditivamente no boot, e o admin edita criando
versão nova — a semente nunca sobrescreve curadoria. A exceção é versão gravada
que não bate mais com o schema: essa é ressemeada, porque o leitor a descarta e
o OS voltaria a projetar sem ofício **em silêncio**.

**Quem classifica é o MODELO, no mesmo turno do briefing.** Sem chamada extra:
`playbookKey` viaja junto das perguntas. A chave é validada contra o catálogo —
chave inventada é ignorada, senão a tela anunciaria um ofício inexistente. Papel
que não casa com nenhum playbook vira linha em `playbook_misses`: é a pauta do
admin, ordenada por frequência, do próximo playbook que vale escrever.

**Havendo playbook, as perguntas do briefing saem DELE.** `worthAsking` é
curado; o modelo não adivinha e não varia a cada chamada (§31). É o que resolveu
"o SO ainda pergunta coisas que ele mesmo já deveria saber".

**O playbook declara a FACETA de cada princípio, e isso não é burocracia.** Sem
a faceta o modelo distribuía como queria e parava na cobertura mínima: catorze
princípios viravam nove itens, e os cinco perdidos eram justamente os
específicos do ofício. Com a faceta declarada, o bloco calcula um ALVO POR
FACETA em número — "skills 3 · behaviors 6 · limits 8" — que o modelo consegue
conferir. Medido: 11 itens antes, 25 depois, com o playbook inteiro coberto.
O alvo é PISO, não teto: declarado como teto, ele suprimia a conduta base.

**A conduta universal é um playbook (`core.conduct`), não só uma seção.** Ela
existia como texto de policy e mesmo assim não virava item — o que faz o modelo
escrever é o alvo contável, e a seção perdia a disputa por cota em silêncio. Os
dois playbooks entram SOMADOS no mesmo alvo. `core.` nunca aparece no catálogo
do classificador: não é um papel entre outros, é o piso de todos.

**O admin da plataforma gerencia playbook por tela** (`/admin/playbooks`, só
para `UserRole.ADMIN`): lista, editor estruturado, histórico e a PAUTA — os
papéis que chegaram sem playbook, agregados de todas as contas por frequência.
Salvar cria versão nova, sempre, com motivo obrigatório: histórico sem motivo é
o mesmo que não ter histórico. A pauta é leitura cross-tenant e passa por
`elevateScope` com registro em auditoria — o tenantGuard barrou a primeira
tentativa e estava certo; a saída não era afrouxar a classificação do modelo.

**Os TIPOS oferecidos no painel vêm dos playbooks**, não de uma lista em
código. O que aparece na tela passa a ser o que o OS sabe projetar bem; os
exemplos sem playbook continuam à mostra, discretos, porque prometem menos.

**E escolher um tipo não custa chamada nenhuma.** A classificação já foi feita
por uma pessoa e as perguntas daquele ofício estão curadas no banco: o briefing
responde direto. Medido: 78s e FALHA pelo caminho longo — três travadas seguidas
do provider — contra 12ms e zero token por este. O caminho longo continua
existindo para papel escrito à mão.

**Rota literal antes de rota paramétrica.** `/agents/types` registrada depois de
`/agents/:id` fazia o Express casar "types" como id e devolver 422. O Express
casa na ORDEM de registro.

**O teto de tempo sai do PAPEL do modelo, não do tipo de chamada.** O papel já
significa quão pesado é o trabalho, e é a mesma informação que diz quanto vale a
pena esperar. Antes, uma saída curta herdava o teto da pesada: o briefing — três
perguntas — esperava 25s por tentativa e falhava em 78s. `hub.fast` e
`validation.fast` declaram 10s de travamento e 45s de teto; o resto usa o padrão
do provider, que é o certo para trabalho pesado.

**O SO calibra o playbook por MUTAÇÃO TIPADA — nunca reescrevendo.** A primeira
versão pedia o documento inteiro de volta e o modelo preservou 14 de 15
princípios. É esse "14 de 15" que condena a abordagem: um item se perdeu e
ninguém teria como saber qual, num documento que é o piso de todo agente daquele
papel, em toda conta. Agora ele localiza o que muda e devolve só isso; pode
tocar várias seções no mesmo pedido, e o que ninguém citou não passa nem perto
do modelo.

Para isso os itens do playbook ganharam `code` + `semanticKey` + `label` — a
mesma forma do resto do canônico. Não é simetria: é a chave semântica que
permite refinar NO LUGAR em vez de criar um item novo dizendo a mesma coisa, e é
ela que faz o `guardAgainstRegression` funcionar aqui sem uma linha a mais.

**Calibrar é operação do OS, não endpoint próprio.** `playbook.refine` roda no
mesmo runner, com escopo `PLAYBOOK` no painel, as mesmas mutações tipadas, o
mesmo versionamento e os mesmos eventos do painel vivo. `PlaybookTarget` é a
quarta implementação de `OperationTarget` e a que prova a abstração: o runner
não sabe que este agregado é de PLATAFORMA e não de conta — o que muda está todo
confinado ao `persist`.

**O OS tem UMA porta: o botão flutuante.** Some quando o painel está aberto, com
um pulso lento que diz "estou aqui", não "clique agora". O botão do cabeçalho
saiu e a caixa embutida no playbook saiu — duas portas para a mesma coisa é o
começo de dois comportamentos diferentes.

A porta é uma ABA colada na borda direita, na altura do olho, e não um círculo
pousado no canto inferior: o painel entra pela direita, e a porta estar nessa
mesma borda diz de onde ele vem antes de abrir. Só o lado de dentro é
arredondado — é o que faz a forma ler como aba em vez de círculo cortado.

**E o painel ocupa a ALTURA INTEIRA da tela**, ao lado da topbar e não abaixo
dela. Ele é o sistema operacional do produto, não um utilitário de uma página:
espremê-lo sob a barra da aplicação dizia o contrário — e comia 56px de conversa,
que é justamente o que se lê ali.

**Os seletores de provider e modelo ficam ACIMA DO CAMPO DE TEXTO**, nos dois
chats, e não no cabeçalho. É no instante de escrever que a escolha importa: no
topo do painel ela ficava longe da fala que ela afeta, e ao lado do rótulo da
operação ela fica junto da outra coisa que muda o resultado do que está prestes
a ser digitado.

**A OPERAÇÃO PEDIDA PRECISA SER DO ESCOPO DA CONVERSA.** O painel guardava a
quick action escolhida e não a limpava ao navegar: clicar "Criar projeto" na
raiz e depois abrir um playbook fazia o composer disparar
`project.create_from_brief` numa conversa `PLAYBOOK`, com a chave
`sales.consultive` como id de projeto. O erro que chegava ao usuário era "O item
que você quer configurar não foi encontrado" — que não diz nada sobre a causa.

Duas correções, e as duas precisam existir: o painel zera a escolha ao trocar de
escopo, e o servidor RECUSA operação de escopo diferente. A segunda é o que
impede qualquer cliente com estado velho de rodar a operação errada com o id
certo de outra coisa.

**O workspace do painel é do ESCOPO, não da conta.** Na tela do playbook ele
dizia "0 projetos, 1 agente · comece pelo projeto" e oferecia "Criar projeto"
como primeira ação — que foi justamente o botão que disparou a operação errada.
Escopo novo precisa do seu `WorkspaceSummary`; cair no da raiz é mentir sobre
onde o usuário está.

**O contexto do painel é derivado da ROTA, sempre.** `resolveHubContext` decide
escopo, saudação e quick actions a partir do pathname, e é reavaliado a cada
navegação: entrar num agente troca o contexto para o dele sem fechar o painel, e
`scope.changed` limpa o transcrito porque cada escopo tem a sua conversa. Nada
disso custa token — é função pura sobre a URL (§31).

**As seções do playbook são ROTAS, não rolagem.** Mesmo padrão das facetas do
agente: é o que faz a sidebar empilhada dizer onde você está. O rascunho vive no
layout, acima das seções, para o admin passear entre elas e salvar UMA vez —
cada seção salvando sozinha produziria uma versão por clique e o histórico
deixaria de contar uma história.

**`w-full` e `w-40` na mesma classe é conflito de Tailwind.** As duas regras têm
a mesma especificidade e quem vence é a ordem da FOLHA, não a da string. Foi o
que espremeu a caixa de texto do princípio até uma letra por linha. Campo que
precisa de largura variável usa base SEM largura mais `min-w-0 flex-1`.

**O admin sobe o ESTUDO, não o prompt.** `POST /admin/playbooks/distill` separa
ofício transferível de arquitetura de produto e devolve um RASCUNHO para ele
revisar — nada grava sozinho. Medido com o relatório real de 59.535 caracteres:
6s, 12 princípios distribuídos pelas seis facetas, 6 limites, 5 fontes. O
documento entra como bloco UNTRUSTED: ele pode conter texto que pareça instrução.

**Playbook é de tempo de PROJETO.** O prompt publicado continua compilado do
canônico — se o playbook vazasse para o runtime, a publicação deixaria de ser
reproduzível (invariante 7). O que fica no agente é só `playbookKey`, como
proveniência: é ela que faz o REFINAMENTO acontecer com o mesmo ofício. Sem
isso, o primeiro ajuste apagaria aos poucos o que o playbook tinha posto lá.

**O documento de pesquisa não é o prompt.** `deep-research-report.md` tem ~15
mil tokens e mistura duas camadas: ofício transferível e arquitetura de produto
de um funil específico. Só a primeira virou playbook. A segunda (máquina de
estados de fase, cards, exits) engessaria o Agent Core, que precisa servir
atendente, recepcionista e suporte pelo mesmo canônico.

**O PERFIL DO PROJETO NÃO CHEGAVA AO AGENTE.** O que ia no prompt era
`profile.summary` — UMA frase. Oferta, público, diferencial, mercado, regra: tudo
o que o usuário cadastrava no projeto morria na tela do projeto. Ele configurava
o negócio inteiro e o agente seguia sem saber o que a empresa vende. No chat
público era pior de outro jeito: `JSON.stringify` do canônico inteiro despejado
no prompt, transferindo ao modelo o trabalho de interpretar a nossa modelagem.
Agora o perfil é COMPILADO em seções, como o agente e a campanha já eram.

**E a regra de negócio HARD atravessa para as REGRAS INEGOCIÁVEIS do agente.**
`businessRules` é a única faceta do perfil com efeito de runtime — as outras
informam, esta obriga. É o mesmo bug do `enforcement` do agente um nível acima:
sem isso, "não trabalhamos com inox" marcado como obrigatório chegaria no meio de
um parágrafo sobre a empresa, com o peso de "prefira ir devagar". Medido pelo
HTTP real: o agente recusou o material e recusou dar prazo, citando a política.

**O bloco vinculante vem ANTES da descrição do negócio.** O perfil é longo —
catálogo, público, mercado — e empurrava a regra inegociável para depois de meia
tela de texto. É o rodapé de novo, disfarçado de contexto. Restrição colocada
cedo governa o que vem abaixo; colocada depois do conteúdo, disputa com ele.

**`market` e `businessRules` entraram porque o usuário chega com elas.** Análise
de mercado e, principalmente, regra de negócio não tinham onde morar — e o que
não tem seção vira `summary` inchado: fica na tela, não é editável, não é
removível, não é versionável, e não chega ao agente como regra. Canônico do
perfil na **v2**, com migração aditiva na leitura.

**Roteamento é trabalho do OS, e precisa estar escrito.** O usuário despeja o
institucional, o catálogo e as regras de uma vez, em texto corrido; ele não sabe
que existem facetas e não precisa saber. A seção `information_routing` da Master
Policy diz onde cada tipo de informação entra, que uma frase costuma alimentar
MAIS DE UMA faceta, o que NÃO é do projeto (preço de ação → campanha; ofício →
agente), e manda dizer O QUE A MUDANÇA AFETA. Medido com um briefing de 12
linhas: 1 público, 1 proposta, 1 diferencial, 1 item de mercado e as 3 regras
declaradas, todas HARD.

**`project.organize_workspace` existe porque a AUSÊNCIA de informação nova muda a
operação.** "Organiza isso" roteado para `refine_profile` faria o modelo INVENTAR
fato do negócio só para ter o que gravar. A operação nova analisa o que já
existe — roteamento errado, regra fraca demais, item escrito como adjetivo,
duplicata, lacuna — e não tem `REMOVE_ITEM`: o que parece sobrar vira
`conflicts` para o usuário decidir, porque o item redundante pode ser o único
lugar onde uma regra dele está escrita. Perfil já bom vira `ANSWER` sem versão
nova.

**O OS lê o PROJETO INTEIRO, não só o perfil.** `project.workspace` traz as
campanhas, os agentes que atuam nelas e o histórico do perfil. Sem as campanhas
ele não sabe o que já está sendo cobrado do documento; sem os agentes não sabe a
quem uma regra nova passa a valer — que é exatamente a frase que o usuário
precisa ler para saber se tem de republicar alguma coisa.

**A FORÇA precisa ser declarável À MÃO.** O formulário de edição manual gravava
tudo como SOFT: um "nunca prometa prazo" digitado na tela chegava ao agente com
o peso de uma preferência, e nada dizia isso. O seletor orientação/obrigatória
entrou no `EditableFacet` — vale para agente e campanha também. DETERMINISTIC
fica de fora: exige checker registrado, e oferecê-lo prometeria "verificada em
código" sem verificação nenhuma.

**As seções do projeto são ROTAS.** Seis facetas numa página só é a rolagem de
dois mil pixels que já custou caro aqui — mesmo padrão das facetas do agente e
das seções do playbook, com contagem na sidebar. A Visão Geral virou a CAPA: o
mapa do perfil com o que está vazio, não o perfil despejado.

**O Lab tem TRÊS recortes, e é o MESMO Lab.** Direto no agente não há negócio
nenhum e o usuário escreve um cenário; pelo PROJETO entra o negócio inteiro;
pela campanha entra o negócio mais o objetivo e o público daquela ação. O do
meio faltava, e é o que responde à pergunta que vem depois de cadastrar o
negócio: "ele aprendeu isso?".

**A tela do Chat Público dizia que o Chat Público "chega na Fase 9"** — com a
Fase 9 pronta. Quem publicava e clicava no item da sidebar lia que o que acabou
de publicar ainda não existe. Ela agora mostra o endereço e a prévia do MESMO
`/c/:publicId`, num iframe: reimplementar a conversa ali daria dois
comportamentos para a mesma pergunta.

**Updater de `setState` não roda na hora, e roda DUAS vezes.** O app está em
StrictMode. Montar lista por efeito colateral dentro de `setX(current => …)`
duplica entradas — foi assim que o composer de anexos travou. Teste de hook que
importa precisa do wrapper `<StrictMode>`: fora dele o bug passa verde.

**Nenhum estado de carregamento pode esperar promessa sem teto.** Todo `fetch`
que alimenta um `disabled`/`loading` leva `AbortSignal.timeout`, e o usuário
sempre tem uma saída manual (remover o anexo). Um request pendurado travou o
painel inteiro sem explicar nada.

**Spinner no lugar errado mente.** O botão Enviar girando durante o upload da
imagem fez o usuário achar que a mensagem tinha sido disparada sozinha. Progresso
de anexo pertence à miniatura; o botão só gira quando ESTÁ enviando.

**Imagem colada no painel vira `MediaAsset`** (invariante 4). Bytes fora do
banco, atrás do port `MediaStorage`; a linha guarda metadado e chave. O upload
acontece ao COLAR, não ao enviar. No provider a imagem é parte da mensagem do
usuário, depois do texto, e nunca da instrução de sistema (§9.1). Validação pelo
CABEÇALHO do arquivo — o `Content-Type` vem do cliente e mente.

**O adapter do Gemini repete em falha transitória** (503/429): o pedido não
chegou a ser servido, não gastou token, e derrubar a operação faria o usuário
perder o que escreveu por um soluço de infraestrutura. Erro de conteúdo e timeout
NÃO repetem — o primeiro é pagar para receber o mesmo não; o segundo pode ter
sido servido e cobrado.

**Mas o prazo é do PEDIDO, não da tentativa.** Cada tentativa tinha o timeout
inteiro para si, então "60s" significava até 183s de espera. Medido no banco
(`ai_calls`): turnos do Lab que levam 1,5s levaram 27s e 31s, e um devolveu
falha depois de 55s — tentativas lentas repetidas sem que ninguém perguntasse se
ainda havia prazo. `planRetry` só repete se o tempo restante comportar a
repetição INTEIRA; sem margem, falhar agora é melhor que falhar depois, porque a
mensagem é a mesma e o usuário recupera o turno mais cedo.

**`.transform()` NÃO pode entrar num schema de saída.** `z.toJSONSchema` lança
"Transforms cannot be represented in JSON Schema", e como o schema é convertido
ANTES de qualquer chamada, toda operação estruturada morria em 0ms com "Falha ao
chamar o provider" — sem sequer tocar a rede. Truncar, normalizar e afins são
responsabilidade de quem EXIBE (`truncatePlanStep`), nunca do contrato.

**A ORDEM das propriedades do schema é engenharia de prompt, não estética.** O
modelo escreve o JSON na ordem em que o schema o apresenta. Com `identity` e
`objective` declarados DEPOIS de `mutations`, ele produzia primeiro o array de
25 itens e chegava ao fim sem os dois campos curtos que não podem faltar —
medido: `undefined` nos dois, saída recusada depois de 118s de geração paga.
Invertida a ordem, a mesma criação passou a entregar 31 itens e os dois campos.
Regra: **curto e obrigatório antes de longo e mecânico.**

**O contrato de saída é BLOCO próprio, de prioridade mínima.** Ele morava no fim
da instrução e funcionava enquanto a instrução era o último bloco. Deixou de ser
quando o playbook e o canônico entraram depois dela — e o sintoma voltou
idêntico. Como bloco (`outputContract` → `DYNAMIC`, prioridade 1) ele fica no fim
independente de quantos blocos alguém acrescente.

**O schema em JSON mode vai ADAPTADO, não cru.** Medido no contrato de criação
de agente: 2.694 tokens contra 723. A união discriminada crua repete os campos
comuns nos dez membros; a achatada diz uma vez e explica os `kind` na
`description`. São ~2 mil tokens em TODA operação, competindo com a instrução
pelo que o modelo retém.

**`io: 'input'`, não `'output'`.** O que o modelo produz é a ENTRADA do nosso
schema — o texto que o Zod vai parsear. Com `'output'` o schema descrevia o
resultado DEPOIS de defaults, marcando como obrigatório todo campo com
`.default()` que o código já sabe preencher. Medido: 10 campos obrigatórios
contra 6.

**Recusa de schema cai para JSON mode, não derruba a operação.** O teto de
complexidade é palpite sobre um limite do SERVIÇO. Quando ele erra, o custo
passou a ser uma requisição perdida — antes era a operação inteira.

**Medido contra a API real (flash-lite), o que o Gemini aceita em
`responseJsonSchema`:** um item de array com 18 propriedades PLANAS passa; o
mesmo item com objeto aninhado e array de objeto dentro é recusado com
INVALID_ARGUMENT. Não é contagem, é profundidade dentro do item. Nenhum dos
contratos atuais do OS cabe — todos rodam em JSON mode. Fazê-los caber exige
tirar as mutações SINGLETON (identidade, objetivo, engajamento) de dentro do
array, o que reduziria a união achatada de 20 para ~11 propriedades. Vale a
pena: schema aceito significa decodificação RESTRITA, onde omitir campo
obrigatório é fisicamente impossível.

**Travamento repete UMA vez; sobrecarga repete duas.** Três travadas seguidas
gastaram 126s antes do erro e a terceira nunca salvou nenhuma. Um 503 é
diferente: ali o provider respondeu dizendo que está ocupado — sinal de vida.

**Vigia de silêncio: um para começar, outro para continuar.** O teto de
primeira palavra não pega stream que começa e MORRE no meio. Medido num
provider degradado: primeiro token em 913ms, e depois **41 segundos** mudo —
a operação ia até o teto de 180s antes de desistir, e o usuário esperava três
minutos por uma resposta já morta. `silenceMs` é relido a cada palavra
(20s conversa · 30s estruturada). Em stream saudável o maior intervalo medido
foi 3,4s, então isto separa "lento" de "morto" sem apressar nada.

**O provider TRAVA; ele não fica lento.** Medido em oito chamadas idênticas de
conversa: ou a primeira palavra chega em ~0,9-1,2s, ou não chega nunca e o
pedido morre no teto. Não existe meio-termo. Isso muda o diagnóstico inteiro —
não adianta esperar mais, adianta DESISTIR mais cedo e refazer.

Por isso o turno de conversa passou a ser lido por `generateContentStream`: o
stream não está ali para mostrar texto aparecendo, e sim para SABER se o pedido
começou. Sem primeira palavra em 8s (25s na geração estruturada), é
`StalledError` — que é repetível, porque um pedido que não produziu token
nenhum não foi cobrado. A regra "timeout não repete, pode ter sido servido" vale
para o pedido que começou a responder; este nunca começou. Medido: 3 de 4 turnos
que morriam no teto passaram a responder.

**Sobrecarga não é erro de programação.** 503/429 esgotado vira
`PROVIDER_UNAVAILABLE` ("o modelo está sobrecarregado agora"), não o
`PROVIDER_ERROR` genérico: a ação certa ali é repetir, não corrigir nada. O
trace guarda a mensagem do provider e o número de tentativas — sem isso, uma
falha de 55s registrada no banco não tinha como ser explicada depois, que foi
exatamente o problema ao diagnosticar esta.

Verificado contra o **Gemini real**, pelo mesmo caminho HTTP que o browser usa,
ponta a ponta: projeto por briefing → agente → campanha dentro do projeto →
vínculo do agente → CTA → publicação → alteração pós-publicação → republicação.

O `MyAIHubOperationRunner` roda sobre `OperationTarget` (`operation-targets.ts`):
Project Profile, Agent Core e Campaign Strategy são três implementações da mesma
porta. Um `if` por tipo de alvo dentro do runner é sinal de que a abstração falhou.

**`scopeIdRole: 'PARENT'`.** Campanha nasce na rota do PROJETO: o alvo ainda não
existe e o id que chega é o do pai. Toda criação de agregado filho usa isso — não
tente carregar o alvo pelo id do pai.

**`contextRequirements` é verificado**, não decorativo: requisito `required` sem
bloco correspondente aborta antes de chamar o provider. É o que impede o modelo de
escrever uma estratégia plausível para um negócio que ele não leu.

**Publicação é imutável e o `publicId` mora na Campaign**, não no deployment —
republicar cria `deploymentNumber + 1`, supersede o anterior e preserva a URL.

**O ESCOPO DE TENANT MORRIA NUM CALLBACK SÍNCRONO.**
`runWithTenantContext(ctx, () => db.algo.findFirst())` perdia a elevação em
silêncio: o `AsyncLocalStorage.run` restaura o escopo anterior assim que `fn`
RETORNA, e o Prisma só dispara a consulta quando a promessa é aguardada — ou
seja, depois. Medido: a MESMA consulta passa com `async () => ...` e falha com
`() => ...`. Havia CINCO call sites com a forma perigosa, e o erro é invisível
até alguém tentar ler o que não deveria. O helper passou a aguardar por dentro:
as duas formas valem igual, e o call site não tem como errar.

**O PUBLIC CHAT serve a PUBLICAÇÃO, não a configuração atual** (§17 Fase 9).
`/c/:publicId`, sem autenticação, fora do portão de login — quem chega veio de
um anúncio e não tem conta. Três defesas: o `accountId` é DERIVADO do
`publicId` no servidor e nunca aceito do request; o limite de taxa é próprio e
apertado (é a única rota em que um anônimo faz o sistema chamar API paga); e o
histórico chega do cliente mas é truncado no servidor.

A resolução `publicId → accountId` é a ÚNICA consulta do sistema que roda antes
de existir tenant — o guard do Prisma barra, e está certo. A saída não é
contorná-lo: é declarar o bootstrap com `systemTenantContext(motivo)`, numa
consulta estreita por construção (chave única, quatro colunas, nada de fora
além do endereço). Depois dela, `publicTenantContext(accountId)` e o guard
valendo como em qualquer outro caminho.

Verificado: troquei o nome do agente depois de publicar e o público continuou
recebendo o nome publicado — invariante 7, medida em vez de prometida. E
endereço inexistente responde o mesmo que campanha despublicada: distinguir os
dois contaria a quem sonda o que existe do outro lado.

**O LAB PELA CAMPANHA é o mesmo Lab** (§17 Fase 8). Dois laboratórios seriam
dois comportamentos para a mesma pergunta, e o segundo nunca receberia as
correções do primeiro. O que muda é o CONTEXTO: direto no agente o usuário
escreve um cenário à mão porque não há negócio em volta; pela campanha ela e o
projeto já dizem negócio, público e objetivo — e o `compileAgentPrompt` ignora
o cenário escrito exatamente por isso.

**NÃO FAÇA À MÃO O QUE O SO DEVERIA FAZER.** Editar a seed para corrigir um
princípio é tratar o sintoma na camada errada: o sistema continua incapaz, e a
próxima correção volta para o meu colo. Quando eu precisar fazer algo que o SO
deveria ter feito, a pergunta é "o que falta para ELE conseguir?" — e é isso
que se implementa.

O histórico do banco mostrou o custo de não perguntar isso: **nove versões
seguidas** de `sales.consultive` (v6→v14) tentando a mesma correção — "sem
saltar para conclusões", "sem atropelar o cenário", "evita premissas
incorretas" — cada uma parecendo um ajuste, nenhuma mudando o comportamento.
Quatro incapacidades ESTRUTURAIS explicavam:

1. **O SO não podia declarar `enforcement`.** `UPSERT_PRINCIPLE` não tinha o
   campo, então todo princípio nascia SOFT — ficava no meio da faceta em vez de
   subir para `REGRAS INEGOCIÁVEIS`. Um "é proibido" chegava com o peso de
   "prefira", e ele não tinha como corrigir nem percebendo.
2. **Só alcançava o playbook do PAPEL.** Correção que valia para todo agente ia
   parar no ofício de vendas, e o piso dos outros papéis seguia sem ela. Agora
   `craftSuggestion.scope` escolhe entre `CONDUCT` e `CRAFT`.
3. **Não enxergava a própria história.** Nada dizia "você já tentou isto". O
   alvo passou a trazer as últimas versões e seus motivos, e a policy manda
   ANALISAR: repetição é diagnóstico de que o problema está na FORMA, não nas
   palavras — regra abstrata, enforcement fraco, regra competindo, ou nível
   errado.
4. **Escrevia proibição abstrata.** A orientação que faz uma proibição funcionar
   ("nomeie a CLASSE e dê a saída") existia só do lado do agente. Agora está
   também onde ele escreve princípio de playbook.

**O PISO NÃO ENCOLHE — nem no playbook.** O agente já tinha
`guardAgainstRegression`; o playbook não, e ele vale para todo agente futuro
daquele papel. Medido no primeiro teste depois de habilitar o SO: ele corrigiu
sozinho e certo, mas devolveu o princípio com 433 caracteres no lugar de 682,
sem a cláusula que fazia a regra funcionar. Perder precisão ali é pior que no
agente — este perde para um usuário, aquele perde para todos que ainda vão
nascer. Mesma margem de 15%.

**Verificado ponta a ponta:** de uma queixa em linguagem natural — "ele decidiu
sozinho que eu tenho clientes próprios só porque falei trampo; isso vale para
qualquer agente" — o SO leu o transcrito, achou o item, classificou como
CONDUTA universal, escreveu em `core.conduct` e marcou HARD. Nada disso ele
conseguia fazer antes.

**SINCRONIZAR COM O OFÍCIO NÃO PASSA POR MODELO.** O texto do playbook é
curado por uma pessoa; aplicá-lo é mutação tipada. Passando por modelo custava
três coisas: tokens, segundos e PRECISÃO — ele parafraseava o princípio (682
caracteres do playbook chegaram como 380, com o caso do momento dentro: "a
partir de preposições como 'em consultoria'") e, quando classificava o pedido
como `ANSWER` em vez de `CHANGE`, não aplicava nada e a tela dizia "concluído"
sem ter mudado uma linha. `POST /agents/:id/sync-craft` escreve pela mesma
porta da edição manual: **873ms contra 30s**, determinístico, custo zero.

**A CHAVE SEMÂNTICA É ÚNICA NO PISO, e a CONDUTA vence.** `core.conduct` e
`sales.consultive` acabaram declarando `behavior.no_operating_model_inference`
os dois — o ofício entra depois e sobrescrevia o piso EM SILÊNCIO. Medido: o
princípio curado de 682 caracteres virou a paráfrase de 335 que o OS tinha
escrito no playbook do papel, e o agente recebeu a pior das duas. Duas defesas:
o piso deduplica mantendo a primeira ocorrência, e a co-escrita do OS grava na
CONDUTA quando a chave já é de lá — evitando a colisão na origem.

**Princípio de playbook declara `enforcement`.** A maioria é orientação; alguns
são PROIBIÇÃO, e a diferença é concreta: HARD sobe para o bloco
`REGRAS INEGOCIÁVEIS` e sai do meio da lista da faceta. Sem poder declarar,
"é proibido supor" chegava com o mesmo peso de "prefira ir devagar". E o piso
NUNCA rebaixa: item que já estava HARD continua HARD (`preserveEnforcement`) —
sincronizar o texto não pode desfazer a decisão de quem projetou o agente.

**Medido, o efeito das três juntas:** a mesma frase que falhava
("Trampo de FullStack em consultoria") passou de ~50% de respostas que
pressupunham para **12 de 12 corretas**, em quatro formulações diferentes,
todas com pergunta ALTERNATIVA ("você pega demandas pontuais ou atua de forma
contínua com eles?") em vez de escolher a leitura mais provável.

**O JEITO DE FALAR não revela o vínculo.** Gíria de trabalho ("trampo", "bico",
"freela") diz o REGISTRO de quem fala, nunca o arranjo — e era por aí que o
agente deduzia. "Trampo" fazia ele ler trabalho avulso e perguntar como a
pessoa capta clientes; "atuo como" fazia ele perguntar aberto. A regra que
resolve não é sobre a palavra: **fala que cabe em mais de uma leitura se
resolve OFERECENDO AS DUAS**, não escolhendo a mais provável.

**O PISO É APLICADO ANTES DE O MODELO ESCREVER, E ELE VÊ O RESULTADO.**
Aplicá-lo depois produzia tudo em dobro: o modelo não sabia que o ofício já
estava lá e escrevia a própria versão de cada princípio, com chave própria.
Medido num agente real: **56 itens onde 30 bastavam**, com pares em 100%
("Nada de escassez falsa" e "Não cria urgência ou escassez falsa"), cada
duplicata disputando atenção com a outra e livre para divergir dela no primeiro
ajuste. Com o piso já no documento de partida, o modelo faz o que sabe fazer com
item existente: refina reusando a chave, ou acrescenta o que falta. Medido
depois: 31–33 itens, zero duplicatas.

**Botão que dispara operação PRECISA mandar o escopo.** "Atualizar pelo ofício"
chamava `send()` sem `scope`, o painel mandava para a raiz e o servidor
recusava com "informe qual operação executar no escopo ROOT". O botão está na
tela do agente, mas quem envia é o painel — e ele não adivinha de onde o clique
veio.

**Versionar o ofício sem invalidar a query é versionar em silêncio.** O OS cria
a v6 do playbook e a tela do admin seguia mostrando a v5 até alguém recarregar.
"Criei a v6" sem a v6 na tela é indistinguível de não ter criado nada — e foi
assim que a co-escrita pareceu não funcionar.

**Detector de vazamento erra nos DOIS sentidos.** "freelance", "trabalho avulso"
e "projeto extra" nomeiam ARRANJOS de trabalho e são exatamente a concretude que
a regra boa precisa ter; a ocupação e o empregador DAQUELE interlocutor não são.
Procurar vocabulário em vez da forma do erro me fez acusar a correção certa
depois de ter deixado passar a errada. O que caracteriza vazamento é o termo que
só existe naquele caso.

**A POLICY EMPURRAVA O ALVO PARA FORA DO CONTEXTO.** O compilador protegia
POLICY incondicionalmente e cortava o resto por prioridade. Como as seções só
crescem — e eu acrescentei três nesta sessão — chegou-se a **9.868 tokens de
policy num teto de 18.000**, e num ajuste real caíram `agent.core` e
`operation.output_contract`: o OS reconfigurou um agente **sem enxergar o
agente** e sem o contrato de saída. O corte é silencioso e a operação termina
"com sucesso"; o `required` do `contextRequirements` não pega porque é
verificado ANTES da compilação.

`essential` separa as duas perguntas que a `priority` respondia com um número
só: em que ORDEM o bloco aparece e quem SAI quando falta espaço. O contrato
precisa das duas pontas opostas — última posição (prioridade 1) e proteção
máxima — e com um número só ele era, por construção, o primeiro a cair.
Essenciais: instrução da operação, contrato de saída, canônico do alvo e a
conversa de teste. Orientação é importante; **o alvo É a operação**.

**O SO LÊ A CONVERSA DE TESTE.** O Lab publica o transcrito no `HubProvider` e
o `send` o anexa quando o escopo é do agente; entra como bloco UNTRUSTED
(metade é fala de terceiro, e uma conversa de teste é exatamente onde caberia um
"ignore as regras anteriores"). Verificado com pedido deliberadamente vago —
"olha a última resposta dele, isso está errado" — e o OS citou a linha exata do
diálogo. Antes, corrigir exigia narrar o que aconteceu ou colar print, e a
correção saía tão boa quanto a descrição.

**Correção de OFÍCIO vira DUAS versões, quando quem pede é admin da
plataforma.** O agente recebe o ajuste e o playbook recebe a mesma correção como
versão nova, por `UPSERT_PRINCIPLE` tipada — reutilizando a `semanticKey`, o
princípio é refinado NO LUGAR. Verificado: `sales.consultive` v5 → v6 e o item
do agente no mesmo turno. Para quem NÃO é admin continua sendo pauta: playbook
vale para todas as contas, e o dono de uma não altera o piso das outras. Falha
ao gravar o playbook não derruba a operação — o agente do usuário já foi salvo.

**Toda regra que o OS toca vira link no painel.** `workspace.patch` carrega
`touched` (faceta, código, rótulo) e o painel monta `?regra=<code>`; a tela da
faceta rola até o item e dá um flash. "Ajustei a ST01" sem o caminho até a ST01
obriga o usuário a caçá-la em sete facetas para conferir — é pedir confiança em
vez de dar evidência.

**O PISO DO PLAYBOOK É APLICADO PELO DOMÍNIO, não escrito pelo modelo.** Pedir
que ele reproduza o princípio devolve PARÁFRASE: medido três vezes seguidas —
chave semântica inventada (1 de 5 reusadas) e cláusulas a menos, sendo a
perdida justamente a que alguém calibrou contra o erro relatado. E chave
trocada é chave que nenhum guard casa, então a garantia não podia viver num
guard. Na CRIAÇÃO, cada princípio vira `UPSERT_*` tipada aplicada ANTES das
mutações do modelo: o aplicador cunha id e código e valida coerência como em
qualquer outra (invariante 6), e o que o modelo escrever depois com a MESMA
chave refina por cima — que é para isso que a chave semântica existe.

Só na criação. Reinjetar a cada ajuste ressuscitaria item que o usuário mandou
remover, e playbook novo não pode reescrever agente publicado (invariante 7).
No ajuste quem protege é o `guardAgainstRegression`, comparando com a versão
anterior — que já contém o piso.

**PERGUNTAR NÃO AUTORIZA SUPOR.** Uma proibição de deduzir não basta: o modelo
pergunta e acha que cumpriu, com a suposição DENTRO da pergunta. "Como chegam
os SEUS clientes?" afirma que ela tem clientes próprios; "nessa sua área"
afirma que aquilo é um setor. A regra precisa dizer isso e dar a forma que
funciona — pergunta aberta que caiba em qualquer resposta. Medido: com a
cláusula, três interlocutores de ofícios diferentes (consultoria, hospital,
transportadora) receberam "como funciona o seu dia a dia lá?" e nenhum
pressuposto. Sem ela, 2 de 3 pressupunham.

**Detector frouxo dá falso verde.** Duas vezes eu declarei "ok" sobre resposta
que pressupunha, porque a regex procurava a frase do caso e não a FORMA do
erro. A pressuposição mora no possessivo ("seus clientes"), no verbo de
captação ("como você consegue trabalhos") e no demonstrativo de setor ("nessa
sua área") — é isso que se procura, não o vocabulário de um caso.

**O `enforcement` NÃO CHEGAVA ao prompt do agente.** O compilador emitia só
`statement`, e um item HARD virava bullet idêntico a um SOFT. Isso quebrava o
produto por dentro: a correção que o usuário mais usa é "isso é obrigatório", o
OS eleva para HARD, a tela mostra a mudança — e o agente em execução recebia o
mesmo texto de antes. Ele testava, via o mesmo comportamento, e concluía que o
sistema não ajustou nada. Estava certo. Não havia teste nenhum sobre isso, e por
isso ninguém viu. Agora HARD e DETERMINISTIC sobem para um bloco
`REGRAS INEGOCIÁVEIS` e SAEM da seção da faceta — dito duas vezes, uma delas no
meio de uma lista longa, a segunda enfraquece a primeira.

**REGRA QUE PROÍBE PRECISA NOMEAR A CLASSE E DAR A SAÍDA.** Proibição abstrata
não é obedecida, é interpretada: "usa estritamente o que o interlocutor
declarou" soa forte e o modelo acredita que cumpre enquanto deduz. Medido — o
agente continuou supondo depois de a regra existir, virar HARD e ser reescrita
três vezes. Trocada por "ocupação, cargo, empresa e formação NÃO revelam como a
pessoa opera; nunca deduza de onde vem o trabalho dela nem se ela mesma vende
ou precifica; quando precisar disso, PERGUNTE", o MESMO flash-lite acertou os
três casos testados, incluindo dois inéditos (enfermeira, motorista). **Não era
limitação do modelo — era a regra escrita como adjetivo.** Sem a segunda parte
("pergunte") o modelo trava em vez de perguntar.

**Regra já existente e já HARD não se resolve com uma quarta formulação.** Cada
item novo disputa atenção com os outros vinte e poucos, então acrescentar
piora. Se está presente, no nível mais forte, e falhou: está ABSTRATA demais.
Torne o item EXISTENTE concreto — e, se nem isso resolver, DIGA. Anunciar
"ajustei" sobre item que já existia faz o usuário testar, ver o mesmo erro e
deixar de confiar no painel.

**O SEED é o AUTOR da Master Policy — corrigir seção existente CHEGA ao banco.**
A semeadura era só aditiva, "porque a seção pode ter sido editada em produção".
Não pode: não existe rota nem método de repositório que edite a Master Policy.
A proteção guardava um caminho inexistente e bloqueava todos os que existem, com
o pior sintoma possível — a correção ficava no código, o sistema seguia com o
texto velho, e nada acusava. **A mesma regra foi "corrigida" duas vezes sem
nunca chegar ao modelo.** `syncSections` põe o banco em dia: acrescenta o que
falta E corrige o que mudou, sempre em versão NOVA, com o motivo dizendo o quê.
Seção que só existe no banco é preservada — apagar orientação por omissão do
arquivo é pior que texto velho, porque o runner pula seção ausente em silêncio.
Se um dia a policy ganhar edição por tela, seção curada precisa de marca própria.

**FATO DO INTERLOCUTOR NÃO É CONFIGURAÇÃO** (seção `ephemeral_facts`, na base).
O que a PESSOA com quem o agente conversou disse sobre si — profissão, negócio,
o cenário do teste — é efêmero e não pertence a nível nenhum. Aparece quase
sempre em relato de falha, porque o usuário PRECISA citar o caso para explicar:
"informei que trabalho em consultoria e ele perguntou de novo dos meus
projetos" virou o `statement` "…não pergunte sobre projetos de quem trabalha em
consultoria", pendurado no agente para todo cliente futuro. Grava-se a
PROPRIEDADE ("não repete pergunta sobre fato já declarado"); o caso é só como
ele a demonstrou.

**E a despersonalização revela o NÍVEL.** Relato vem em primeira pessoa e
PARECE instância. O teste é sobre o item, não sobre a frase: se para escrever
foi preciso TIRAR o caso, e o que sobrou vale para qualquer agente do papel,
é ARQUÉTIPO — vai para `craftSuggestion` além de entrar no agente.

**`craftSuggestion` vem ANTES de `mutations`.** Estava depois do array de 25
itens e simplesmente não era preenchido — o modelo chegava ao fim da parte longa
e não escrevia o campo curto. Curto e decisório antes de longo e mecânico, a
mesma regra que já custou `identity` e `objective`.

**Reiniciar MANTENDO contexto é retomada, não abertura.** O endpoint de abertura
não recebia histórico: o agente se reapresentava e perguntava o nome de quem
acabara de dizê-lo, com o transcrito na tela contradizendo a fala. Com
histórico, o marcador de turno diz para continuar de onde parou — e o atalho de
custo zero do `SCRIPTED` fica de fora, senão devolveria a saudação de estreia a
quem já foi saudado.

**A Master Policy é semeada no BOOT** (`main.ts`): seção nova entra numa versão
nova; seção existente é corrigida quando o texto do seed mudou. Antes disso ninguém a semeava fora dos testes e o OS rodava em
produção com `policy = null` — funcionava, e era por isso que não se via.
Operação que declara seção inexistente é barrada por teste (`operation.test.ts`),
porque o runner pula seção ausente em silêncio.

**O painel é um CONSOLE, não um chat.** Ele abre mostrando estado (`workspace.ts`)
e lacuna antes de qualquer campo de texto, com as ações reordenadas pelo que
falta resolver primeiro. Nada disso custa token: é função pura sobre o documento
canônico. Perguntar ao modelo "o que falta neste projeto?" responderia diferente
a cada vez — intolerável num painel de operação (§31).

**Custo viaja no `operation.completed`** e aparece sob cada turno. Medido:
~4.700 tokens e US$ 0,0006 por operação no flash-lite.

**RELATO DE FALHA NÃO É PEDIDO DE REMOÇÃO** (seção `diagnosis`, em toda
operação). "ele NEM está pedindo o nome" é queixa de que o comportamento
falhou; "não peça o nome" é pedido para tirá-lo. Uma palavra separa as duas, e
o OS leu a primeira como a segunda: apagou o que o usuário queria e respondeu
confiante que tinha ajustado. Diante de relato de falha o OS DIAGNOSTICA —
item existe? é força ou clareza? há regra competindo? — e reforça, nunca
remove. Na dúvida, responde o que encontrou em vez de mexer.

**A abertura entra no `guardAgainstRegression`.** `engagement` é objeto de campos
escalares, fora do guard de itens: um ajuste sobre outra coisa apagava a
diretriz de abertura sem aviso, e o usuário reestabelecia a mesma coisa a cada
rodada. Trocar SCRIPTED por ADAPTIVE continua sendo escolha, não perda.

**O Lab do agente exige CENÁRIO antes de conversar.** Pela campanha o contexto
já existe — ela e o projeto dizem negócio, público e objetivo. Direto no
agente não existe nada disso, e o teste media a imaginação do modelo em vez
da configuração. O fluxo é: Testar → cenário → conversa (e só então o agente
abre, se a iniciativa for dele). O `testScenario` entra depois do negócio e
antes das facetas, com a ressalva de admitir o que não sabe em vez de
inventar — cenário SITUA a conversa, não é base de conhecimento. Com campanha
o cenário é ignorado, e a regra vive no `compileAgentPrompt`, não no caso de
uso: duas descrições da mesma conversa não têm como ser desempatadas.

**EXEMPLO NÃO É ESPECIFICAÇÃO** (seção `examples` da policy, em toda operação).
Quando o usuário escreve "ex:" e cola uma frase, ele mostra uma PROPRIEDADE —
tom, formalidade, tipo de pergunta. Gravar o texto no lugar da propriedade
produz um agente que repete a mesma frase para todo mundo, e ele só descobre
testando. Foi o que aconteceu com uma saudação de boas-vindas.

**Abertura tem MODO, não só texto.** Um campo só juntava coisas opostas:
`openerMode: 'SCRIPTED'` usa `opener` literal (só quando o usuário QUER a mesma
frase sempre); `'ADAPTIVE'` — o default — formula na hora seguindo
`openerGuidance`, e o `opener` vira REFERÊNCIA de tom, nunca a fala. O atalho de
custo zero do Lab vale só para SCRIPTED: em ADAPTIVE ele devolvia o campo
verbatim e o agente abria a conversa recitando a própria diretriz ("Inicia a
interação de forma cordial…"). FALA é primeira pessoa; DIRETRIZ é terceira.

**Pergunta pertence a um NÍVEL.** O agente é da CONTA e atua em qualquer
projeto: produto, preço, cliente ideal e desconto máximo são fatos legítimos que
simplesmente não moram nele — são da campanha; diferencial competitivo é do
projeto. O briefing pedia justamente esses quatro, e o usuário respondia coisas
que o sistema não tinha onde guardar. A régua é uma pergunta só: "a resposta
continuaria valendo se este mesmo agente fosse usado em outra campanha, de outro
produto?". Se não, é da campanha. O que cabe no agente é ESPECIALIZAÇÃO: setor,
canal, fronteira de autonomia, como se apresenta.

A regra vive na seção `information_level` da Master Policy — não na instrução
de uma operação. Ela já existia em prosa dentro do `CREATE_AGENT`, e o briefing,
que é outro caminho de código, tinha a sua própria versão dizendo o CONTRÁRIO.
Regra duplicada em dois lugares diverge; a seção é o único lugar.

**`BASE_POLICY_SECTIONS` existe porque a lista de seções era copiada seis
vezes.** Seção nova entrava em quatro operações e faltava em duas — aconteceu com
`diagnosis` e com `examples`. Como o runner PULA seção ausente em silêncio,
nada acusava em execução. O teste do catálogo agora exige a base inteira em toda
operação.

**A pergunta vem ANTES de criar o agente.** O usuário escolhe o papel,
`POST /api/agents/briefing` devolve 2–4 perguntas sobre FATO DO NEGÓCIO, ele
responde, e só então o agente nasce. Perguntar depois era criar sem saber e
pagar um segundo turno para refazer metade da configuração. A pergunta de
**quem inicia a conversa** é fixa em CÓDIGO e vem primeiro: vale para todo
agente e a resposta vira `SET_AGENT_ENGAGEMENT` por mutação manual, não por
confiar que o modelo lembre. Com `initiator: AGENT` o prompt ganha o bloco
"VOCÊ ABRE A CONVERSA" cedo, e o Lab dispara a primeira fala sozinho — com
`opener` definido isso não gasta token nenhum, a frase já está no canônico.

**`assessAgent()` é função PURA sobre o canônico.** A Visão Geral do agente é a
CAPA — chat com ele à esquerda, prontidão e mapa à direita. A nota responde
UMA pergunta ("posso publicar?") e cada ponto perdido vem com o que fazer;
quantidade NÃO entra na conta, senão o OS aprenderia a multiplicar item.
Perguntar ao modelo "está bom?" daria nota diferente a cada chamada (§31).

**O painel CONVERSA, não só executa.** O modelo declara `intent` em toda saída
(`ANSWER` | `CHANGE`) e num turno de resposta o runner para antes de aplicar
mutação, versionar ou auditar. Sem isso, "ele já é capaz de se adaptar?" gravava
uma estratégia nova — o usuário perguntou e o sistema mexeu no que funcionava. A
decisão é do MODELO porque separar pergunta de ordem é semântico; heurística
sobre palavra erra. O campo mora em `output-intent.ts` e é espalhado nas TRÊS
bases de saída, com teste que falha se uma esquecer.

**O painel é HÍBRIDO.** Conversa é para INTENÇÃO ("quero que ele seja mais
objetivo"); formulário é para CORREÇÃO (trocar uma palavra, digitar a URL de um
CTA, apagar um item). Mandar correção para o modelo gasta token para reproduzir
o que o usuário acabou de escrever — e às vezes reproduz errado. O caminho
manual (`POST /api/{projects|agents|campaigns}/:id/mutations`) NÃO é porta dos
fundos: monta as mesmas `CanonicalMutation` tipadas, passa pelo mesmo aplicador
e versiona igual, só com `source: 'USER'`. O vocabulário faceta→mutação vive em
`@myaihub/shared` (`*_FACET_MUTATION`) e o backend DERIVA os mapas dele —
duplicar os nomes faria a tela dizer "salvo" enquanto a API devolvia 422.

**Site citado na mensagem vira contexto `UNTRUSTED`.** O runner extrai URLs da
fala e busca o conteúdo (`WebContentReader`). Sem isso o modelo recebia só a
string da URL e escrevia um perfil a partir do nome do domínio — medido: um
projeto inteiro saía com uma frase. A defesa de SSRF valida o IP RESOLVIDO (não
o texto do host) e revalida cada salto de redirect; ver `web-content-reader.ts`.

**O painel pertence a um ESCOPO.** Navegar para outra entidade limpa o
transcrito (`scope.changed`) e troca a conversa do backend — cada escopo tem a
sua. Antes o painel guardava o turno da criação do projeto na tela do agente até
o logout, e o usuário lia uma resposta que não era sobre o que estava vendo.

**Limite medido do Gemini:** `responseJsonSchema` é recusado acima de ~14
propriedades agregadas. O adapter degrada sozinho para JSON mode com o schema na
instrução (`gemini-schema.ts`). Não simplifique o contrato canônico para caber no
limite de um provider — a ferramenta não dita o domínio.

**Campo que o modelo erra, não descarta o item.** Nome de checker inventado,
prefixo de `semanticKey` errado, `type` fora do vocabulário: tudo isso é forma,
e o conteúdo é o que o usuário disse. O aplicador corrige ou rebaixa e emite
`VALUE_ADJUSTED` — só rejeita o que violaria uma invariante. A exceção que não
se negocia: `DETERMINISTIC` sem checker registrado E com params válidos vira
`HARD`, porque o painel exibe "verificada em código" e isso não pode mentir.

**O OS decide ONDE aplicar o ajuste: INSTÂNCIA ou ARQUÉTIPO.** A seção
`calibration_level` da policy entra nas operações de agente E de playbook. O
teste é um só: "se outro cliente criasse um agente deste MESMO papel, do zero,
ele deveria nascer já com isto?". Sendo de OFÍCIO, o OS faz as DUAS coisas —
aplica no agente na hora e grava `craftSuggestion`, que vira pauta do admin.
Ninguém espera por ninguém: abrir chamado para o admin calibrar o playbook
devolveria ao usuário a espera que ele veio evitar. Na dúvida, é instância.

O INVERSO também: calibrando o playbook direto, pedido que é da instância (ou
do projeto/campanha) vira `ANSWER` dizendo onde aquilo mora — não uma versão
nova do piso de todo mundo.

**A seção de calibração é do AJUSTE, não da criação.** Pôr `calibration_level`
em `agent.create` custou duas criações recusadas de 105s e 79s, com o modelo
inventando `kind` em `mutations.1` e `mutations.12`. Criar não tem correção
para rotear — o usuário descreveu um PAPEL, não apontou comportamento errado — e
eram ~670 tokens de deliberação disputando atenção com o contrato de saída mais
pesado do sistema, que é justamente onde o modelo já erra por dispersão. Tirada
dali: 8.599 tokens de entrada contra 10.222, e duas criações em 62s e 30s. Antes
de acrescentar seção numa operação, pergunte se aquela DECISÃO existe ali.

**`kind` inventado não pode custar a saída inteira.** É o discriminador: um
valor fora do vocabulário derruba o `safeParse` completo, e a saída de uma
criação tem trinta itens bons dentro. `agentMutationsSchema` descarta o item e
só ele — mesma regra que já vale para `type`, checker e prefixo de
`semanticKey`. Aqui não dá para corrigir: sem saber qual mutação ele queria,
adivinhar seria pior. A validação do que sobra NÃO afrouxa. Cuidado ao mexer:
`z.preprocess` sobrevive ao `z.toJSONSchema`, mas `.transform()` não.

**O contrato de saída é de TODA operação, e o teste cobra.** Ele existia em
três das oito; as outras cinco confiavam na instrução ser o último bloco, que é
exatamente a premissa que já quebrou uma vez. `outputContract` sai por
`ANTES DE RESPONDER, CONFIRA` e o teste falha se alguém acrescentar operação
sem ele — porque a ausência não dá sintoma nenhum até o dia em que dá.

**Saída recusada por schema CUSTOU, e agora aparece.** O provider gerou, cobrou
e respondeu; quem recusou fomos nós, ao validar. O erro genérico gravava
`in=0 out=0`, então a chamada mais cara do sistema — uma criação recusada de
105s com 3.987 tokens de saída — entrava no banco como se fosse de graça. É o
contrário do que o produto promete: o painel mostra a conta enquanto ela é
feita, e o turno que o usuário mais sente é justamente o que falhou.
`StructuredOutputError` carrega o `usage` até o `ai_calls`.

**Falha do OS fora do runner era invisível.** `resume(...)` tinha `.catch(() =>
undefined)` porque "o runner registra a falha" — mas ele só registra DEPOIS de
começar. Exceção antes disso deixava a operação RUNNING para sempre, sem um
evento sequer, e o painel girava sem explicar. Agora vai para o log.

**Playbook evolui; agente NÃO muda sozinho.** O canônico carrega
`playbookKey` (origem, imutável) e `playbookVersion` (até onde ele viu,
recarimbada a cada operação — o ofício vigente esteve no contexto daquela
rodada). Versão vista menor que a vigente vira OFERTA na tela do agente, e
aceitar roda o caminho normal de ajuste, com `guardAgainstRegression` no meio.
Reescrever o agente porque um admin editou um documento noutra tela faria o
comportamento em produção virar do avesso, e o usuário descobriria pelo cliente
dele. `playbookVersion === 0` é agente anterior ao carimbo: não avisa, porque
avisar seria adivinhar.

**NÃO declare `thinkingBudget` no turno de conversa.** O campo não é um TETO:
declarar um valor baixo LIGA um passe de raciocínio que sem ele não acontece, e
o valor nem é respeitado. Medido com o prompt real de um agente (1.324 tokens),
3 turnos: **com 128** → 2,5s · 14,0s · 2,7s, raciocínio 371 · 379 · 500;
**sem o campo** → 1,0s · 0,7s, raciocínio 0 · 0 · 0. Pior: os tokens de
raciocínio NÃO contam como primeira palavra, então o vigia de travamento
disparava com o modelo trabalhando — e um turno chegou a terminar com
`out=0 think=399` gravado como SUCCESS, entregando fala vazia ao Lab.
`thinkingBudget: 0` também não serve: 400 INVALID_ARGUMENT.

Eu mesmo introduzi isso medindo com um prompt de BRINQUEDO, sem instrução de
sistema — que não dispara raciocínio de jeito nenhum. **Otimização medida fora
do caso real mede outra coisa.**

**Resposta vazia é falha, não sucesso.** Stream que abre, fecha e não traz texto
virava turno em branco no Lab — para quem está testando se o agente responde,
um agente mudo é pior que um erro. `EmptyResponseError` repete uma vez e tem
mensagem própria: dizer "sobrecarregado" ali manda quem investiga para o lugar
errado.

**O provider NÃO é binário: ele fica lento, e o lento chega.** A regra antiga
("ou a primeira palavra vem em ~1s ou não vem nunca") não vale mais. Medido em
10 turnos: 790 · 833 · 897 · 953 · 1.144 · 1.376 · 4.357 ms, e então 14.537 ·
27.507 · 30.017 ms. Dois grupos separados por um vazio entre 4,4s e 14,5s.

**TODO PEDIDO AO PROVIDER TEM QUE SER NECESSÁRIO.** Houve aqui uma corrida de
pedidos: passados 4s de silêncio, um segundo partia AO LADO do primeiro — que
continuava vivo — e ganhava quem falasse primeiro, até três no ar. Ela cortava a
cauda lenta pela metade (mediana 1.313ms contra 16s e erro) e mesmo assim está
REMOVIDA, porque o preço é gastar por especulação: um pedido disparado sem o
anterior ter falhado, num sistema em que cada pedido custa dinheiro e consome
cota diária. Nos ~70% de turnos rápidos ela nunca disparava; nos outros,
duplicava ou triplicava a conta sem ninguém ter autorizado.

O que ficou resolve o mesmo problema sequencialmente: 4s de silêncio TOTAL é o
sinal de que ESTE pedido travou — o primeiro token saudável chega entre 0,8s e
1,4s, e o grupo lento só aparece depois de 14s. Aos 4s mata-se este e refaz-se
UM, já sabendo que o anterior morreu. Falhando de novo, o erro vai para a tela
com o botão de tentar de novo: a decisão de gastar mais uma vez é do usuário,
não do sistema. Medido depois da remoção, 8 turnos: mediana 2.049ms, pior
9.749ms, uma requisição por turno.

**Repetição SEQUENCIAL continua existindo, e é diferente.** Ela acontece depois
de uma falha conhecida, nunca ao lado de um pedido que ainda pode responder —
que é exatamente a distinção entre necessário e especulativo.

**O AUDITOR não repete, e o teto do papel é quem diz isso.** `validation.fast`
roda depois da resposta do agente, na frente do usuário. Travando, a escolha não
é entre auditar rápido ou devagar: é entre entregar a resposta agora dizendo
"não consegui conferir" ou segurar o turno por meio minuto — medido, 16s, 17s,
21s e 34s por uma auditoria que roda em 800ms. Com `stallMs` 6s e `totalMs` 9s a
repetição não CABE (`MIN_TIME_TO_RETRY_MS` exige 5s de folga), então ela não
acontece: o Lab mostra "checagem indisponível", que é verdade e custa zero.

**A CONVERSA DEIXOU DE SER DO CLIENTE** (Fase 8). O histórico vinha do
navegador nos dois canais, e isso custava três coisas: recarregar a página
apagava o atendimento no meio, o servidor acreditava no cliente sobre o que ele
mesmo tinha respondido, e a Fase 10 não tinha o que medir. Agora o cliente manda
um `sessionId` e o histórico é lido do banco. A sessão nasce ligada ao
`deploymentId` e morre com ele — republicar não troca o agente embaixo de quem
está falando.

**O Lab persiste, em CANAL PRÓPRIO.** `channel: LAB` fica fora de toda métrica.
A razão de o Lab ser efêmero — "experimento que suja o relatório faz o relatório
deixar de servir" — continua valendo; quem a resolve agora é o canal, não a
ausência de persistência. O que se ganhou: o teste sobrevive a um recarregamento,
e é ele que o OS lê para diagnosticar.

**Um turno inteiro numa TRANSAÇÃO.** As duas falas, os contadores e os eventos
saem juntos. Gravar a pergunta numa ida e a resposta noutra deixa a janela em que
a conversa mostra pergunta sem resposta — e é justamente nessa janela que o
usuário recarrega, porque foi a lentidão que o levou a recarregar.

**Evento de violação é UM POR VIOLAÇÃO, não por turno.** O dashboard agrega por
CHECKER, e um evento agregado obrigaria a abrir o payload para saber qual regra
falhou — que é exatamente a pergunta que a tela existe para responder.

**`OBJECTIVE_REACHED` só na TRANSIÇÃO.** O modelo redeclara o objetivo alcançado
em todo turno seguinte, porque ele continua verdadeiro. Emitir o evento a cada
vez inflaria a conversão de uma sessão em quantos turnos ela tiver depois disso.
Pelo mesmo motivo o progresso NÃO retrocede por omissão: turno em que o modelo
não declarou nada não significa que a conversa andou para trás.

**O PATCH DE ESTADO PEGA CARONA na validação semântica.** É o padrão do `plan`
do painel: o campo viaja numa resposta que já está sendo paga, então o estado da
conversa custa zero token a mais. Uma chamada separada por turno só para "ler
sinais" dobraria o custo de cada atendimento para produzir OPINIÃO — e opinião é
justamente o que entra marcado como `DECLARED`, valendo menos que o que o código
observou.

**A validação semântica roda `on` no Lab e `sampled` em produção.** No Lab o
usuário está perguntando se a configuração pega, e amostrar responderia "talvez"
à pergunta que ele veio fazer; o custo é dele, num turno que ele mesmo disparou.
Em produção, um atendimento longo pagaria uma validação por turno sem que a taxa
de violação mudasse o suficiente entre turnos para justificar.

**Falha do validador NÃO derruba o turno.** A resposta já foi produzida e já foi
paga; recusá-la porque um auditor auxiliar não respondeu entregaria ao visitante
um erro no lugar de uma resposta que provavelmente estava boa. O que se perde é a
checagem — e isso vai para o log, não para a tela dele.

**A MARCA é documento próprio, não campos do perfil.** O perfil diz o que o
negócio É; a marca diz como ele se APRESENTA, e as duas coisas mudam por motivos
e em ritmos diferentes. Trocar a cor não pode criar uma versão do documento que
descreve o que a empresa vende — o histórico do perfil deixaria de contar uma
história.

**Só o TOM da marca chega ao agente.** Cor e logo são da página; o tom é a única
parte com efeito sobre o que ele FALA, e entra no prompt ANTES das facetas
porque ele as MODULA. Sem isso, "nossa marca é informal" ficava no CSS enquanto
o agente respondia como um contrato — a mesma classe de bug do perfil que não
chegava, um nível acima.

**A mutação da marca é SINGLETON e faz MERGE.** Identidade visual não é lista de
itens: cor não tem `semanticKey` nem `enforcement`, e inventar isso para ela
caber no formato das outras facetas produziria um vocabulário que ninguém usa —
o OS acabaria criando um "item" por cor. E o merge é campo a campo: "deixa a cor
mais escura" chega com um campo, e aceitar o documento inteiro de volta faria o
modelo reescrever o rodapé legal em silêncio.

**CONTRASTE É CALCULADO, não adivinhado pelo modelo.** Trocar a primária sem
dizer a cor do texto é o pedido normal, e é assim que nasce texto branco sobre
amarelo. O domínio calcula a legível pela luminância (WCAG) e AVISA; valor
declarado pelo usuário nunca é sobrescrito. Quem publica não descobre isso antes
de um cliente não conseguir ler a tela.

**Conhecimento o OS LÊ; ele não muta.** Fonte não é documento de configuração, é
o conteúdo do cliente. Pedir que o modelo o resuma devolveria paráfrase — o mesmo
erro que já custou caro no playbook, com o agravante de que aqui o texto perdido
é um fato do negócio dele. Por isso `ProjectKnowledgeSource` não tem mutação
tipada: tem formulário.

**Revisão IDÊNTICA não cria revisão.** Reindexar uma página que não mudou geraria
um id novo descrevendo exatamente o mesmo texto, e cada publicação seguinte
congelaria uma revisão diferente sem diferença nenhuma — o histórico deixaria de
dizer quando o conhecimento de fato mudou.

**O snapshot é criado NA PUBLICAÇÃO, não reaproveitado.** Reaproveitar o último
faria uma fonte adicionada depois dele nunca entrar no ar, e o usuário não teria
como saber por quê. E snapshot vazio não é gravado: um id que não descreve nada
faria o manifest afirmar ter congelado conhecimento que não existe.

**O chat público lê do SNAPSHOT; o Lab, da revisão CORRENTE.** É a mesma
diferença do perfil: o público recebe o que foi publicado, e o Lab responde à
pergunta "o que eu cadastrei agora funciona?".

**O conhecimento entra por ÚLTIMO entre os blocos de conteúdo.** É material de
consulta, não configuração: colocado antes das regras, um documento longo
empurraria para baixo tudo o que governa o comportamento — o mesmo erro do
rodapé, com outro nome. E entra marcado como CONTEÚDO, com o aviso no próprio
bloco: um "ignore as regras anteriores" dentro de um PDF institucional é
exatamente o cenário que a separação existe para cobrir.

**A recuperação usa a ÚLTIMA fala como consulta, não a conversa inteira.** Com a
conversa toda, toda pergunta recuperaria os mesmos trechos do começo do
atendimento. E pontua por TERMOS DISTINTOS que bateram, não por ocorrências:
contar ocorrências premiaria o trecho que repete a mesma palavra dez vezes sobre
o que responde à pergunta inteira uma vez só.

**`manifestVersion: 2`.** `brandIdentityVersionId` e `knowledgeSnapshotId`
entraram porque sem eles a publicação era imutável só pela metade. Deployment
gravado na v1 continua legível — `readManifest` migra na LEITURA e o documento
gravado NUNCA é reescrito: mudar o hash desfaria a única coisa que ele existe
para garantir. Há teste que falha se alguém tentar.

**O dashboard é DERIVADO, sem contador incremental paralelo.** Contador que se
atualiza sozinho diverge da tabela que ele resume, e aí o número deixa de ser
conferível. A taxa de conversão é sobre conversas ENGAJADAS (mais de uma fala do
visitante): quem abriu e fechou sem dizer nada não teve chance de converter, e
contá-lo no denominador afunda a taxa com um número que não fala sobre o agente.
E a mediana de turnos, não a média — a distribuição tem uma cauda de sessões de
um turno só.

**A janela do dashboard é FIXA (7/30/90) e cortada em UTC.** Intervalo livre
convida a comparar o incomparável, e "agora menos 7 dias" moveria a fronteira a
cada recarregamento — o gráfico mudaria sem nada ter acontecido. A série inclui
os dias VAZIOS: sem eles, o gráfico emenda uma semana movimentada com a seguinte
e esconde a queda.

**O CTA conta como OFERECIDO, nunca como clicado.** Que o endereço apareceu na
resposta o código observa; que alguém clicou, só o público sabe — medir clique
exigiria um redirecionador nosso, e prometer o número sem isso seria inventá-lo.

**A SUÍTE DE INTEGRAÇÃO NÃO PEGA ESCRITA SEM TENANT.** Ela usa o client CRU, sem
o tenantGuard, justamente para poder montar estado cross-tenant e PROVAR o
isolamento. O efeito colateral é que um `update({ where: { id } })` num modelo de
conta passa verde ali e explode em produção. Aconteceu três vezes nesta rodada —
marca, conhecimento e sessão de conversa —, e as três só apareceram no navegador,
uma por vez. `tenant-scoped-writes.test.ts` varre o código-fonte e barra a forma
singular: use `updateMany`/`deleteMany` com `accountId` no `where`.

**O E2E roda contra o FAKE, e num banco PRÓPRIO.** O que ele testa é a
APLICAÇÃO — rota, cookie httpOnly, sidebar, formulário que salva —, não o
modelo: um E2E que depende do Gemini falha por indisponibilidade alheia e vira
ruído que ninguém investiga. A jornada contra o provider real tem lugar próprio
(`npm run smoke:journey`).

**O E2E loga UMA vez e reusa a sessão.** Não é economia de tempo: o limite de
autenticação é de 20 tentativas por 15 minutos, e ele existe porque essa é a
superfície de força bruta. Logar por teste esbarrava nele — a suíte falhava por
um mecanismo de segurança funcionando exatamente como deveria. Afrouxar o limite
para o teste passar seria testar um produto que não existe. O login pela tela
continua coberto pelos testes do portão, que usam contexto limpo.

**`e2e:api` roda em `tsx watch`.** Com `reuseExistingServer`, o Playwright
reaproveita a API já no ar entre execuções — e sem o watch ela seguiria servindo
o código de antes da última correção. Custou um ciclo inteiro de depuração aqui:
o teste falhava contra um servidor velho, apontando para um bug já consertado.

**A ORDEM dos `-e` do dotenv-cli importa: o PRIMEIRO vence.** `dotenv -e .env
-e .env.e2e` faz o E2E rodar contra o banco de DESENVOLVIMENTO. É `.env.e2e`
primeiro. E o E2E tem PORTA própria (3334): com o `reuseExistingServer` do
Playwright, uma API de desenvolvimento na 3333 seria adotada como se fosse a
dele, e os testes rodariam contra o banco errado.

**PERSISTIR NO SERVIDOR RESOLVE METADE.** A Fase 8 gravava a conversa e o
`sessionId` vivia na memória do React: um F5 perdia o ponteiro e a tela voltava
vazia com o atendimento inteiro no banco. A promessa central da fase estava
cumprida pela metade, e documentada como pronta. O cliente guarda o id em
`sessionStorage` e pede o transcrito de volta — `GET /api/public/:publicId/
sessions/:sessionId` no chat público, `GET /api/conversations/:id` no Lab.

`sessionStorage` e não `localStorage`: o problema é o F5 no meio do atendimento,
e a aba é o recorte disso. Em `localStorage`, uma conversa de semanas atrás
ressuscitaria sozinha quando a pessoa voltasse ao anúncio.

**A sessão do transcrito é validada CONTRA O ENDEREÇO.** Id de outra campanha
responde "não existe", igual a um id inventado — senão quem tivesse um sessionId
qualquer leria a conversa de outra publicação.

**ESTA FALHA ERA INVISÍVEL PELO SERVIDOR.** Os testes de integração provavam a
persistência e passavam verdes o tempo todo; o que faltava era o caminho de
volta, que só existe no navegador. É o mesmo motivo de o E2E existir — e foi ele
que travou a regressão.

**O TESTE RECARREGAVA NO MEIO DO VOO.** A fala do usuário é otimista: ela pinta
antes de o servidor gravar. Esperar por ela e recarregar acusava a restauração
de um problema que era do teste. Espere o TURNO (`waitForResponse`), não o
pixel.

**O CAMPO DE TEXTO DO PAINEL TAMBÉM ESTÁ NO DOM.** `getByRole('textbox').last()`
acertava ele, e o teste digitava num lugar que ninguém vê. Localizador por NOME
acessível, nunca por posição.

**`npm run e2e` BUILDA antes de rodar.** O `vite preview` serve o `dist/`, e sem
o build a suíte testa a versão anterior — o snapshot de falha mostrava um texto
que já não existia no código. É a mesma armadilha do `reuseExistingServer` na
API, do outro lado.

**A tela não podia mais dizer "nada aqui é salvo".** O Lab persiste desde a Fase
8. O que continua verdade é o que importa ao usuário — não entra em métrica, não
afeta publicação — e é isso que a tela diz agora. Promessa que virou mentira é
descoberta no pior momento.

**A SUÍTE DE INTEGRAÇÃO NÃO PEGA ESCRITA SEM TENANT.** Ela usa o client CRU, sem
o tenantGuard, para poder montar estado cross-tenant e PROVAR o isolamento. O
efeito colateral: `update({ where: { id } })` num modelo de conta passa verde ali
e explode em produção. Aconteceu três vezes — marca, conhecimento e sessão —, e
as três só apareceram no navegador. `tenant-scoped-writes.test.ts` varre o
código e barra a forma singular.

**O PATCH DE ESTADO NÃO PODE DERRUBAR A AUDITORIA.** Ele pega carona na chamada
de aderência, que existe para auditar a resposta. Medido no banco: duas saídas
recusadas — e com elas o veredito — porque o modelo escreveu `"orçamento e
prazo"` como chave e omitiu o `note` de dois sinais. A chave agora é
NORMALIZADA (`z.preprocess`, que sobrevive ao `z.toJSONSchema`; `.transform()`
não) e a entrada malformada é DESCARTADA, item a item. É a mesma regra do
aplicador de mutações: campo que o modelo erra na FORMA não descarta o conteúdo.
Verificado depois: três turnos, três `validation.fast` SUCCESS, e as chaves
gravadas como `orcamento_e_prazo` e `prazo_pretendido`.

**Estado de sessão sem gatilho não existe.** `status`, `endedAt` e
`SESSION_ENDED` supunham um encerramento — job de expiração ou ação explícita —
e nenhum dos dois existe. Coluna que nunca sai de OPEN mente sobre o que o
sistema sabe; ela volta junto do gatilho. `visitorKey` idem: quem separa as
conversas é o `sessionId`, e nada lia a coluna.

**Número sem o caso por trás não corrige nada.** O dashboard media conversas,
custo e violações sem um caminho para LER o que foi dito — e corrigir é o motivo
de medir. O painel de conversas abre o transcrito com a violação colada na fala
que a produziu, por `?conversa=<id>` (mesmo padrão do `?regra=<code>`), então a
conversa aberta é um endereço.

**O dashboard tem TETO, e diz quando cortou.** Sem teto, um recorte de 90 dias
numa conta movimentada carrega tudo em memória — o custo aparece justamente
quando o produto vai bem. Com teto e sem aviso, a tela mostraria um número
redondo que não é o número. `truncated` resolve a segunda metade.

**Remover fonte congelada é 409, não 500.** O `Restrict` do
`KnowledgeSnapshotItem` protege a publicação, mas o P2003 cru dizia ao usuário
que o sistema quebrou. A checagem vem ANTES, com a mensagem que explica o que
fazer.

**O formulário da marca apagava o que o usuário digitava.** O efeito de
recarga tinha o OBJETO nas dependências, e o TanStack devolve um objeto novo a
cada refetch. Dependa da VERSÃO.

**O trace registra os trechos que entraram** (`knowledgeRefs`, §8.1). O manifest
congela QUAL snapshot vale; sem isto o trace sabia a base e não sabia o que dela
foi usado — "reproduzível" ficava pela metade. Ids e pontuação, nunca o texto: o
conteúdo é do cliente e o trace é lido por operadores.

**`prisma migrate dev` PODE RESETAR o banco de desenvolvimento.** Ele faz isso
ao detectar drift, e o aviso sai no INÍCIO da saída — que é o que some quando se
lê só as últimas linhas. Foi assim que o banco de dev se perdeu nesta rodada.
Quando a migração envolve perda de dados ele fica INTERATIVO e trava: aí o
caminho é `prisma migrate diff --script`, revisar o SQL, gravar à mão e aplicar
com `migrate deploy`.

**QUANDO O SO NÃO DÁ CONTA, O DEFEITO É DO SO.** Se o usuário levou um problema
ao painel e o SO não resolveu, a pergunta NÃO é "qual é a resposta certa?" — é
"o que falta para ELE conseguir?", e é isso que se implementa. Corrigir o
artefato à mão trata o sintoma na camada errada: o sistema continua incapaz e a
próxima ocorrência volta para o mesmo lugar. Já custou nove versões seguidas de
`sales.consultive` tentando a mesma correção, quando o que faltava eram
capacidades ESTRUTURAIS. Tocar o artefato só vale para verificar a hipótese; o
que fica no commit é a capacidade nova.

**O SO ESCREVE O OFÍCIO QUE FALTA** (`playbook.create`). `PlaybookTarget.empty()`
LANÇAVA — "playbook não nasce por operação do OS" — e a consequência era ele
detectar a própria lacuna sem poder fechá-la: papel sem ofício virava
`PlaybookMiss`, o agente nascia genérico, e alguém escreveria o playbook à mão
algum dia. Registrar o próprio limite e esperar um humano é o oposto do que o
produto promete.

A curadoria não some, muda de lugar: o admin passa a revisar um rascunho REAL,
versionado e auditado, em vez de partir do zero — e `playbook.refine` continua
sendo como se corrige o que ficou errado.

**A CHAVE do ofício é IMUTÁVEL depois que ele existe.** Ela entra por
`SET_PLAYBOOK_IDENTITY` e o aplicador só a grava quando o documento ainda está
no marcador. Renomear órfãozaria a proveniência: todo agente carrega
`playbookKey`, e é por ela que o refinamento acha o ofício certo — o agente não
some, ele passa a apontar para um ofício que não existe, em silêncio.

**Ofício com a chave-MARCADOR é pior que erro.** Ele entraria no catálogo, o
classificador passaria a oferecê-lo, e a criação seguinte sobrescreveria a
anterior — duas curadorias no mesmo endereço. Sem chave, o `persist` recusa:
é falha de SAÍDA, não documento a gravar.

**O SO LÊ A EVIDÊNCIA DE CAMPO.** Ele diagnosticava com uma mão amarrada — lia o
transcrito do LAB e nada mais. As conversas públicas estavam no banco desde a
Fase 8 e as violações contadas desde a Fase 10, e a única forma de ele saber
disso era o usuário narrar. Agora `agent.field_evidence` traz as regras que mais
falharam em produção, com a fala que violou e a pergunta que a provocou.

É a diferença entre "acho que ele promete prazo" e "esta regra falhou 4×, aqui
está o caso". Diante da primeira ele reescreve no escuro. Só o canal PUBLIC
entra: violação no Lab é o usuário testando o limite de propósito.

**A PAUTA entra no contexto da criação.** Os papéis que chegaram sem ofício, por
frequência, mais o catálogo do que já existe — para ele não escrever um ofício
que se sobrepõe a outro. Leitura cross-tenant, por `elevateScope` com motivo;
só o agregado atravessa.

**LOG DE PROCESSO EM TEMPO REAL** (`operation.trace`). O painel tinha três
passos e um giro: entre "interpretando o pedido" e "salvando" o usuário esperava
dezenas de segundos sem nada — e é ali que mora a chamada ao modelo, a parte
cara e a que às vezes trava. Cada linha descreve algo que ACONTECEU, com
carimbo; nada de barra de progresso inventada, que ensina a não confiar na tela.
Custo zero: mesmo canal SSE. O log vai junto para o turno arquivado, para quem
rola para trás entender por que aquele turno custou o que custou.

**O HISTÓRICO DO PAINEL É ÚNICO E CONTÍNUO.** Trocar de escopo ZERAVA o
transcrito: o usuário perdia a resposta que acabara de ler só por ter ido
conferir o que o OS mudou — e conferir é justamente o que o painel pede que ele
faça. Agora o escopo AGRUPA em vez de apagar, com o nome do contexto como
cabeçalho de cada bloco.

Agrupa por SEQUÊNCIA, não por chave: voltar ao mesmo agente depois de passar por
um projeto abre um grupo NOVO, porque foi isso que aconteceu.

**O turno em curso é arquivado ANTES da troca de escopo.** Ele pertence ao
contexto em que foi pedido, não ao que o usuário abriu depois. A operação não é
interrompida — termina no servidor —, mas a vista dela fecha.

**O transcrito sobrevive ao F5 e MORRE no logout.** `sessionStorage` com a chave
do USUÁRIO: numa máquina compartilhada, quem entra depois não lê a conversa de
quem saiu. Só turnos ENCERRADOS são guardados: o turno em curso pertence a um
stream que já morreu.

**Quem apaga é o LOGOUT, não a ausência de usuário.** O gatilho era "havia
usuário, agora não há, logo saiu" — inferência, e larga demais: qualquer piscada
da sessão passava por logout, e a reação era `forgetHubHistory()` SEM userId, que
varre o histórico de todos. Medido: duplicar a aba zerou a conversa do painel.

Sair é um ato, e é no `useLogout` que ele acontece. O que restou no provider é a
única regra que precisa ser inferida — TROCA de usuário (`A → B`, ambos
presentes) apaga o de A —, e ela é observável sem depender de um `null`
ambíguo. Sessão expirada continua coberta: ela termina no logout, que apaga.

**E gravar não pode acontecer antes de LER.** O efeito de escrita rodava no
mesmo commit em que o usuário chegava, com `turns` ainda vazio, e sobrescrevia o
guardado com `[]` antes de a restauração ser aplicada. No caminho feliz o valor
voltava no commit seguinte; bastava fechar a aba, navegar ou perder a sessão
nesse intervalo para sumir de vez. Uma trava (`restored`) impõe a ordem.

**O SHELL É PRESO À VIEWPORT** (`h-dvh overflow-hidden`), e a rolagem acontece
só dentro das regiões. Não existe `height: 100%` em html/body/#root, então
`h-full` no shell resolvia contra altura automática: o painel ficava tão alto
quanto a conversa dentro dele, a PÁGINA passava a rolar, e rolar deslocava o
painel deixando uma faixa vazia embaixo.

**O S.O TESTA O AGENTE ANTES DE DIZER QUE AJUSTOU.** Era a peça que faltava
para ele ser um sistema operacional e não um editor de documento: gravava a
versão, escrevia "ajustei", e quem descobria se a correção pegou era o usuário —
no teste seguinte, de graça para o sistema e caro para ele. Onze versões de um
agente, seis reclamando da MESMA coisa, e nenhuma etapa do processo em que
alguém tenha reexecutado a conversa para conferir.

Agora o runner pede um ENSAIO (`AgentRehearsal`, implementado no módulo de
agentes): pega a última fala do interlocutor no transcrito que motivou a queixa,
roda contra a configuração RECÉM-SALVA, no mesmo cenário do Lab, e um juiz curto
(`validation.fast`, com a regra recém-escrita na mão) diz se o erro se repetiu.
O ensaio NÃO persiste conversa — é ensaio, não atendimento.

E reprovando, **o S.O corrige o próprio trabalho**: a resposta reprovada volta
como bloco de contexto ("VOCÊ JÁ TENTOU ESTA CORREÇÃO E ELA NÃO PEGOU") e a
operação roda de novo. UMA vez. A primeira falha é informação nova — o modelo
escreveu a regra sem saber como o agente responderia a ela; a segunda seria a
décima paráfrase que este repositório já provou não resolver nada, e aí a
resposta honesta é mostrar a frase do agente e pedir o que ele DEVERIA ter dito.
Medido ponta a ponta pelo HTTP real: 15,3s e US$ 0,0028 a operação inteira,
ensaio incluído.

**O CUSTO DA CORRIDA É DA SAÍDA, NÃO DO FORMATO.** A conversa corria (hedge aos
4s, até 3 no ar) e a geração estruturada não, "porque duplicar custa milhares de
tokens". Vale para criar um agente (~8.500 tokens de saída); não vale para o
auditor de aderência, que gasta ~1.030. E era ele o passo lento do laboratório:
medido, `agent.runtime` respondia em 906ms de mediana enquanto `validation.fast`
— serializado na frente da resposta do usuário — marcava 16s, 17s, 21s e 34s.
O usuário esperava meio minuto por uma AUDITORIA. `timing.hedgeAfterMs` é
declarado pelo papel (`hub.fast`, `validation.fast`) e o provider corre também
na estruturada. Medido no mesmo roteiro de teste: mediana do turno do Lab de
**10.109ms → 4.278ms**, pior caso de **36.224ms → 9.737ms**.

**PROIBIÇÃO E OBRIGAÇÃO NÃO PODEM DIVIDIR A MESMA LISTA.** `limits` é escrito
como sintagma nominal ("Apresentar preço antes de entender o problema") e só
significa alguma coisa sob um cabeçalho que diga "nunca faça"; as outras facetas
são imperativas ("DIAGNOSTICA ANTES DE PROPOR"). O compilador jogava as duas
num bullet só sob `REGRAS INEGOCIÁVEIS`, e metade das linhas mandava fazer o que
a outra metade proibia, sem nada distinguindo. O efeito era invertido justamente
onde mais importa: subir um limite para HARD — que é como o usuário diz "isso é
proibido" — TIRAVA dele o cabeçalho `O QUE VOCÊ NUNCA FAZ`. A regra ficava mais
fraca depois de promovida. Agora o bloco tem dois rótulos: `É PROIBIDO` e
`VOCÊ SEMPRE FAZ`.

**VERSÃO QUE NÃO MUDA NADA NÃO É GRAVADA.** Mutação APLICADA não é documento
ALTERADO: um `UPSERT` que devolve o texto que já estava lá é uma mutação
bem-sucedida que não muda coisa nenhuma. Medido no histórico: de nove ajustes,
dois gravaram versão sem UMA diferença no prompt compilado, e o que separava a
v5 da v6 era `source: MYAIHUB_BASELINE → USER` no mesmo item, com o mesmo texto.
O usuário tinha acabado de perguntar "você ajustou o que eu já havia te pedido?"
e recebeu uma versão nova como se a resposta fosse sim. `changesConfiguration`
ignora escrituração (`rationale`, `source`, `updatedAt`, `playbookVersion`) e o
turno vira RESPOSTA, dizendo qual dos dois casos ocorreu — o texto já era esse,
ou a reescrita foi descartada por encolher. Vale também na edição manual, onde
o `SET_AGENT_ENGAGEMENT` que o painel dispara após todo briefing produzia uma v2
idêntica à v1 em TODO agente novo.

**O GUARD COBRAVA UMA REGRA QUE NINGUÉM TINHA CONTADO AO MODELO.**
`guardAgainstRegression` descarta `statement` que encolhe mais de 15% — e a
instrução nunca dizia isso. Então o modelo escrevia refinamentos mais curtos e
mais cirúrgicos, o domínio os revertia em silêncio, e a queixa voltava na rodada
seguinte. Nos eventos: quatro `VALUE_ADJUSTED` de "perderia detalhe na
descrição" em quatro turnos diferentes, sempre nos mesmos dois itens. A seção
`diagnosis` da Master Policy passou a dizer a regra e a forma que funciona:
repetir o texto atual inteiro e ACRESCENTAR a cláusula nova.

**"REGRAS CUMPRIDAS" SÓ QUANDO ALGUÉM CONFERIU.** O validador engolia a própria
falha e devolvia `null`, que também significava "não havia o que checar"; quem
chamava somava `?? []` e o Lab pintava o selo verde. Medido: três turnos exibiram
"regras cumpridas" enquanto o `validation.fast` morria com PROVIDER_UNAVAILABLE.
`AdherenceResult.status` separa `CHECKED` de `UNAVAILABLE`, o `TestAgentResult`
carrega isso até a tela, e o Lab tem um terceiro estado: "checagem indisponível".

**CAMPO DESCRITIVO NÃO DERRUBA A SAÍDA.** `interpretedIntent` era
`.max(300)` puro e uma frase de 310 caracteres recusava a operação INTEIRA —
medido: duas chamadas pagas seguidas (761 e 604 tokens de saída) rejeitadas, e o
usuário lendo "saída estruturada não bate com o schema" por causa do tamanho de
uma legenda que não governa comportamento nenhum. Reproduzido: 1 falha a cada 3
ajustes. É o mesmo erro que o `plan` já tinha custado, e a lição vale igual: o
limite existe porque a coluna é `VarChar(300)`, então quem o respeita é o
CÓDIGO, cortando (`describedField`, com `z.preprocess` — `.transform()` não
sobrevive ao `z.toJSONSchema`), não o modelo, acertando. Depois: 4 de 4 ajustes
concluídos.

**E QUANDO FALHA, A MENSAGEM DIZ ONDE.** "Saída estruturada não bate com o
schema" é verdade e não serve para nada: não diz o campo, não diz se a culpa é
do modelo ou do nosso contrato, não diz o que fazer. Os detalhes já iam para o
log desde que uma investigação ficou impossível sem eles — só não chegavam a
quem estava olhando a tela. Agora o evento de conclusão nomeia os campos.

**O TEMPO QUE O USUÁRIO SENTE NÃO É O TEMPO DA API.** Com o turno já em ~2,5s,
a revelação do texto a 45 caracteres/segundo levava mais 5,5s numa resposta de
250 caracteres — DEPOIS de ela ter chegado. A animação existe para o texto não
brotar de uma vez, não para medir o tempo de leitura de ninguém: `MAX_REVEAL_MS`
põe teto de 900ms na revelação inteira, e frases curtas mantêm o ritmo de antes.

**O CUSTO APARECE EM REAIS, E O TOTAL APARECE.** O valor por turno já existia em
dólar; ninguém soma doze linhas de cabeça, e "US$ 0,0026" doze vezes não diz se
o mês foi de centavos ou de dezenas de reais. `GET /api/metrics/spend` devolve o
acumulado do MÊS (é assim que a conta do provider fecha) com a cotação junto, e
o cabeçalho do painel e o do Lab mostram o mesmo número.

A cotação vem do **PTAX do Banco Central**: é a taxa oficial brasileira — a que
contabilidade, contrato e fisco usam —, é pública, não pede chave e não tem
cota. Um agregador de mercado daria um número que ninguém confere depois e que
muda a cada minuto.

O padrão de acesso é o recomendado para dado que muda uma vez por dia: busca
uma vez, guarda em memória, serve SEMPRE do cache e atualiza por trás quando
envelhece (TTL de 6h, aquecido no boot). Nenhuma tela espera pela rede, e a
fonte recebe ~2 requisições por dia em vez de uma por clique. O PTAX é publicado
em dia ÚTIL por volta das 13h, então a busca anda para trás até achar o último
boletim; falhando tudo, o valor anterior continua sendo exibido marcado como
`stale` — um número de ontem é melhor que um traço, desde que a tela não minta
sobre a idade dele.

**O custo continua GRAVADO em micros de dólar.** Converter na gravação
congelaria uma cotação dentro do histórico, e o valor deixaria de ser
recalculável. A conversão é de EXIBIÇÃO, feita na leitura, e o `title` de todo
valor carrega o dólar original e a cotação usada — número de dinheiro sem a taxa
não é conferível.

**DUAS CHAVES DO GEMINI: a gratuita primeiro, a paga quando o dia acaba.**
`GEMINI_API_KEY_PAYED` entra só depois de a cota gratuita esgotar, com o mesmo
modelo. E a pergunta difícil não é qual usar — é como saber que a gratuita
voltou sem gastar cota perguntando.

**Não existe endpoint de saldo.** A documentação de limites descreve os TETOS
(RPM, TPM, RPD) e manda conferir o tier no AI Studio — uma tela, não uma API.
`countTokens` e `models.list` gastariam requisição para devolver a mesma dúvida.

Então não existe sonda: **quem testa se o gratuito voltou é a próxima chamada de
verdade** (circuit breaker em meio-aberto). Gratuita disponível → usa e nada é
gasto verificando. 429 → marca até quando ela está fora, e a retentativa que já
existia para erro transitório serve a MESMA requisição pela paga, sem o usuário
ver erro nenhum. Passado o prazo, a próxima chamada real volta a tentar a
gratuita: voltando, seguimos de graça; ainda fora, o 429 renova o prazo. Custo
da verificação: zero, porque a verificação é o trabalho.

**Até quando ela fica fora, em três fontes:** o `retryDelay` do próprio erro
(nada que a gente invente é melhor que o número que o Google mandou); cota
DIÁRIA (`PerDay`/RPD) → **meia-noite do Pacífico**, que é quando a documentação
diz que ela reseta, lida pelo `Intl` para acertar o horário de verão; o resto,
um minuto. O bloqueio nunca ENCURTA: dois pedidos em voo devolvem 429 quase
juntos, e o segundo adiantaria a volta para antes do reset real.

Medido ao vivo: 429 na gratuita às 19:19, bloqueio até `07:01Z` (00:01 PDT do
dia seguinte, com a margem de um minuto), três turnos seguintes servidos pela
paga sem uma falha na tela.

**429 não é 503.** Sobrecarga se resolve repetindo na MESMA chave; cota
esgotada devolve o mesmo não. Tratar os dois igual gastaria a chave paga em toda
oscilação do serviço.

**O que isto NÃO resolve:** os limites do Gemini são por PROJETO, não por chave.
Duas chaves do mesmo projeto dividem a mesma cota e não há fallback nenhum — a
paga precisa vir de um projeto com faturamento próprio. É configuração, e o
código não tem como conferir: só o 429 da paga denunciaria.

**A COTA GRATUITA NÃO É COBRADA, e o número na tela precisa ser verdade.** O
mesmo modelo, no mesmo pedido, custa dinheiro por uma chave e zero pela outra:
o preço de tabela é do provider, não da chave. `LlmResult.tier` sobe até o
`RecordAiCall`, que zera o custo do turno gratuito e grava a cota no
`pricingSnapshot` — sem isso, custo zero ao lado de uma linha de preço válida
seria indistinguível de erro de cálculo. E `/api/metrics/spend` devolve qual
cota está servindo: um sistema que muda de bolso sozinho precisa dizer que
mudou.

O estado do bloqueio vive em MEMÓRIA e morre no restart — de propósito. Persistir
exigiria tabela para um dado que se reconstrói sozinho: depois de reiniciar, a
primeira chamada tenta a gratuita, toma 429 e a retentativa a serve pela paga.
Custa uma tentativa por restart, e é a mesma meia-abertura de sempre.

**O CONSUMO VEM DO PROVIDER, POR TENTATIVA — nunca de conta nossa.** Um pedido
que trava é abortado e refeito, e o que travou consumiu o prompt antes de
emudecer. Contando só a tentativa que respondeu, o sistema exibiria menos do que
a fatura vai cobrar, justamente no número que existe para o usuário saber quanto
gasta.

A tentação era estimar — "a descartada tinha o mesmo prompt, some o input de
novo". Isso é chute com aparência de conta, e num número de dinheiro chute é
pior que ausência: ninguém consegue conferir, e ninguém sabe que precisa. O
`UsageLedger` anota o que o Gemini informou em cada tentativa e soma. O stream
reporta consumo ACUMULADO, então a anotação nova substitui a anterior DA MESMA
tentativa (somar pedaço a pedaço contaria o mesmo token várias vezes); tentativas
diferentes somam, porque foram pedidos diferentes. Tokens somam, latência não:
vale a do turno, que é a única que alguém esperou.

A tentativa que morre sem ter reportado nada NÃO entra. É a consequência
assumida da regra: se o Google cobrar um pedido que abortamos antes de ele
informar qualquer coisa, o total sai a menos — e ficar a menos COM origem é
melhor que ficar "certo" com um número inventado.

**O Gemini não devolve DINHEIRO, devolve TOKEN.** Não existe custo por
requisição na resposta da API: o que ele reporta, e reporta com autoridade, é
`usageMetadata`. O dinheiro sai desses tokens contra `AiModelPricing`, que é
tabela versionada com `effectiveFrom` e snapshot por chamada — não estimativa.
Se um dia um provider passar a devolver o custo, ele entra no lugar do cálculo.

**`ledger.record` passado solto perde o `this`.** Passar a referência do método
para dentro do stream fez toda chamada morrer com `PROVIDER_ERROR: Falha ao
chamar o provider`, e o turno chegava ao Lab sem tokens e sem resposta. Vai
closure, não método.

**O GESTOR DE MODELOS é do ADMIN da plataforma.** Provider e modelo em dois
selects, ao lado do chat, como em qualquer interface de IA — no painel do S.O.
(`hub.reasoning`) e no Lab (`agent.runtime`). Trocar o modelo muda o custo e o
comportamento de TODAS as contas, então é a mesma fronteira do playbook:
`requireRole('ADMIN')`, e o usuário comum não vê os selects nem recebe 200 na
rota.

**A escolha é por PAPEL, não por conversa.** O papel já é a abstração que o
sistema inteiro usa — nenhum use case sabe que modelo está falando, ele pede
`agent.runtime`. Amarrar o modelo a uma conversa criaria um segundo lugar
guardando a mesma decisão, com a garantia de divergirem. Os cinco papéis
cobrem toda interação com IA do produto: `hub.reasoning` (criar e ajustar
agente, projeto, campanha e ofício), `hub.fast` (perguntas do briefing),
`agent.runtime` (Lab, chat público e ensaio), `validation.fast` (auditoria de
regra e juiz do ensaio), `analysis.vision` (print colado no painel).

**A precedência tem três degraus, e a COTA GRATUITA ganha de todos.** Enquanto
ela estiver de pé, a rota fica travada no modelo que ela serve — gastar num
modelo pago tendo requisição gratuita disponível é queimar dinheiro por opção de
tela. Esgotada a cota, a escolha do admin passa a valer (aí já se está pagando,
e vale escolher bem); sem escolha nenhuma, vale o padrão da env, que é o que faz
o sistema subir num banco que nunca teve a tela aberta.

**Mas quem diz se a cota acabou é o FATO, não o adapter.** A primeira versão
perguntava ao provider qual chave ele usaria — previsão, que reinicia com o
processo. Resultado medido: depois de um restart os selects ficavam travados
"por causa da cota gratuita" enquanto TODA chamada saía pela paga. É o mesmo
erro do badge, do custo estimado e do selo de regra cumprida, pela quarta vez:
mostrar o que se supõe no lugar do que aconteceu.

`ServedTierObserver` guarda a cota que serviu de fato — alimentado pelo gateway
a cada chamada e SEMEADO no boot a partir de `ai_calls`, para já estar certo
antes do primeiro turno. A previsão do adapter continua atrás dele, como
fallback para o caso de nunca ter havido chamada nenhuma. A leitura de boot é
cross-tenant por natureza (a cota é do projeto do Google, não de uma conta) e
roda em `systemTenantContext`, numa consulta estreita — o mesmo padrão do
bootstrap do Public Chat.

A trava ADIA a escolha, não a apaga: o que o admin gravou continua no banco e
volta a valer sozinho quando a cota acabar. Descartar obrigaria a reescolher a
cada virada de dia. E a tela DIZ que está travada, com o motivo — select
desabilitado sem explicação é bug aos olhos de quem usa.

**Provider sem chave aparece na lista, desligado, com a variável que falta.**
Esconder OpenAI e Anthropic daria a entender que não existem, quando o que falta
é uma linha no `.env`. A disponibilidade vem da CHAVE, nunca de uma lista
"habilitados" no código — no dia em que a chave entrar não há código a escrever.
E a rota RECUSA apontar um papel para provider sem chave: o sistema ficaria
quebrado até alguém desfazer pela mesma tela.

**O modelo tem que existir no catálogo** (`AI_MODEL_CATALOG`, em
`packages/shared`, um lugar só para os dois lados). Sem essa checagem, um id
digitado errado viraria erro do provider no meio da próxima operação do
usuário — longe daqui, sem dizer que a causa foi esta tela.

**A rota é resolvida A CADA CHAMADA, não no boot.** `ModelRouter` passou a
aceitar uma função no lugar do objeto fixo; é o que faz a troca valer no turno
seguinte, sem reiniciar o processo. O estado vive em memória e recarrega a cada
escrita — com várias instâncias, cada uma leria o próprio cache até a próxima
escrita, e a correção ali é invalidação por evento, não polling.

**A Topbar mostra QUAL COTA SERVIU — só em desenvolvimento, e é FATO, não
previsão.** Em produção seria ruído: quem usa o produto não decide de qual bolso
a chamada sai. Em desenvolvimento é a diferença entre testar de graça e torrar a
chave paga a cada tecla.

A primeira versão devolvia o estado em memória do adapter — e ele é PREVISÃO,
que reinicia junto do processo. Depois de um restart o adapter volta a supor que
a cota gratuita está de pé, e a Topbar dizia "cota gratuita" enquanto as
chamadas saíam pela paga: medido, com as linhas de `ai_calls` marcadas `PAID`
provando o contrário do que a tela afirmava. O mesmo erro que este sistema já
tinha cometido com o custo do turno e com o selo de "regras cumpridas" — mostrar
o que se supõe no lugar do que aconteceu.

Agora o `tier` vem de `ai_calls`, que é o que o provider serviu de fato; a
previsão continua junto, em `quota.next`, porque é ela que explica a trava do
seletor e o horário em que a gratuita volta. Sem chamada nenhuma, o badge some:
melhor não afirmar que afirmar um palpite.

O bloqueio da chave continua em memória — perdê-lo custa UMA tentativa depois de
cada restart (tenta a gratuita, toma 429, a paga serve) e nada mais, porque a
trava que ele reativa aponta para o modelo mais barato de qualquer forma.

**`model_routes` é UNSCOPED**, como a Master Policy e os playbooks: uma conta não
escolhe o modelo que as outras usam. Migração escrita À MÃO e aplicada com
`migrate deploy` — `migrate dev` já resetou o banco de desenvolvimento uma vez
neste repositório, e o aviso dele sai no INÍCIO da saída, que é o pedaço que
some quando se lê só as últimas linhas.

**O LAB REINICIA UMA VEZ, NO FIM — não a cada versão.** O gatilho era a VERSÃO
mudar, e isso funcionou até o S.O passar a conferir o próprio trabalho: um único
pedido do usuário produz DUAS versões (a correção e a rodada de reforço), e cada
uma disparava uma saudação paga que ninguém leu. Medido no relato do usuário:

```
ajuste → v31 → saudação → auditoria → reprovou → v32 → saudação → auditoria
```

Duas saudações e duas auditorias de Lab por pedido, metade jogada fora no
instante seguinte. Agora o gatilho é o TRABALHO TERMINAR (`working` some), e a
conversa reinicia uma vez, já com a última versão. Versão igual à que a conversa
reflete não reinicia nada: seria pagar uma saudação para mostrar o que já estava
na tela.

**E enquanto ele trabalha, a tela do alvo FECHA** (`CalibrationVeil`). Conversar
com uma configuração que está sendo reescrita produz resposta que já não
corresponde a nada — token gasto para gerar confusão, e o usuário concluindo
coisas erradas sobre um agente que mudou no meio da frase.

O conteúdo continua MONTADO por baixo, só inalcançável (`opacity-0`,
`pointer-events-none`, `aria-hidden`). Desmontar perderia a conversa de teste —
que é justamente o que o S.O está lendo para se corrigir e o que precisa
reiniciar quando ele terminar.

A malha é sorteada com semente FIXA e congelada: a mesma rede em toda
calibração, porque uma rede diferente a cada vez pareceria estado diferente. O
que muda com o trabalho é a LUZ — cada linha nova do log acende os nós por um
instante. Nada de barra de progresso inventada: o movimento na tela corresponde
a algo que aconteceu, pela mesma razão que o log mostra carimbo de horário em
vez de porcentagem.

**A rodada de correção não reenvia a IMAGEM.** Ela já foi lida na primeira
passada e o que dizia está embutido na versão recém-gravada; reenviá-la paga o
anexo mais caro do contexto duas vezes pelo mesmo pedido. O que a segunda rodada
precisa é da evidência do ensaio, que é texto curto.

**O FIM DA OPERAÇÃO TEM SOM, e ele é SINTETIZADO.** Uma operação leva de 8 a 40
segundos e ninguém fica olhando: quem pede vai para outra aba e volta quando
lembra. O som devolve o instante do fim sem exigir a tela à vista — é o mesmo
motivo do log ao vivo, para quem não está olhando.

Nada de arquivo de áudio: o timbre nasce de osciladores e ruído na Web Audio
(`hub/sound.ts`), então não há asset para servir, cachear ou versionar, e o
efeito soa igual offline. Um mp3 de meio segundo custaria mais bytes que o
arquivo que o gera.

O timbre é sino de FM — senoide modulada numa razão INARMÔNICA (2,01×), que é o
que o ouvido lê como metal e não como apito —, com a modulação decaindo mais
rápido que a nota (o brilho é do ataque; sustentá-lo deixa o som áspero), um
sopro de ruído passa-banda subindo de 700Hz a 5kHz, e reverberação por resposta
impulsiva gerada em runtime (ruído decaindo em dois canais descorrelacionados —
largura estéreo de graça).

**Acerto SOBE, falha DESCE.** Ré·lá·ré·mi ascendente contra duas notas descendo
uma terça menor, mais escuras e mais curtas. Anunciar erro com o som do acerto
ensina o usuário a ignorar o som.

Toca no ÚNICO ponto em que a operação termina (`operation.completed`), mais o
`catch` do envio — falha antes de começar não passa por lá e, para o usuário, é
o mesmo fim. `playOutcome` NUNCA lança: exceção ali subiria pelo handler e
derrubaria o painel no pior momento, que é quando o resultado chega. O teste
roda no jsdom, que não tem Web Audio — é exatamente o cenário que se quer provar.

O botão de silenciar fica no cabeçalho do painel, de onde o som sai: quem quer
desligar está incomodado AGORA, e mandá-lo procurar uma tela de preferências é
pior que não ter o botão. Ligar TOCA o som — sem ouvir, o botão pede um voto
sobre algo que a pessoa não conhece, e é o clique que libera o áudio no
navegador.

**O S.O NÃO ENXERGAVA OS AGENTES DA CONTA a partir do projeto.** Perguntado
"qual agente você indica pra esse projeto?", ele respondeu "ainda não há nenhum
agente criado na conta" e ofereceu criar um — com o agente pronto, configurado
e testado do outro lado da sidebar. O `project.workspace` só trazia quem já
atuava numa campanha DAQUELE projeto, e a ausência virou AFIRMAÇÃO. O custo do
erro é um agente DUPLICADO, que daí em diante recebe metade das correções.

Agora o bloco lista também os OUTROS agentes da conta, com o papel de cada um,
e manda indicar um deles em vez de propor outro. O vínculo em si continua sendo
ato explícito e continua morando na CAMPANHA — é lá que se decide quem fala com
o cliente, e criar já vinculando ao "primeiro agente disponível" seria o sistema
escolhendo isso pelo usuário. O que faltava era o S.O poder dizer "use o Alex".

**E a tela do Lab do projeto afirmava o mesmo falso.** O agente padrão saía dos
agentes DO PROJETO, e o seletor só aparece com mais de uma opção: conta com um
agente e nenhuma campanha caía no estado vazio — "esta conta ainda não tem
agente" — sem oferecer caminho nenhum até ele. O padrão passou a sair das
OPÇÕES (os do projeto na frente, os demais depois), e uma linha diz de onde
aquele agente veio e onde o vínculo mora.

**O SOM SÓ TOCA COM O USUÁRIO LONGE DA TELA.** Ele existe para quem saiu; para
quem está com o painel na frente não informa nada que a tela já não diga, e
aviso que não informa é o que ensina a desligar o som. São duas perguntas e as
duas importam: `visibilityState` pega a aba trocada e a janela minimizada;
`hasFocus` pega a janela lado a lado, no segundo monitor ou atrás do editor —
visível e sem ninguém olhando. O botão de ligar o som passa `force`: ali a
pessoa está olhando de propósito e o som É a resposta ao clique dela.

**O S.O ESCOLHE O QUE FAZER — antes quem escolhia era o CHIP da tela.** A
operação chegava pronta do painel (o último botão clicado, ou o padrão da rota)
e toda frase do usuário era forçada dentro dela. Medido, e o custo é o pior
tipo: ele pediu "cria a campanha de estamparia" com o chip em `refinar perfil`;
`project.refine_profile` rodou, não tinha como criar campanha nenhuma, e o
modelo — obrigado a responder alguma coisa — descreveu o que FARIA. A tela de
campanhas continuou vazia e a resposta parecia um "pronto". **Nada falhou, e
nada aconteceu.**

Nenhuma correção DENTRO da operação resolveria: ela não é capaz do que foi
pedido, e a operação certa existia ali do lado. O que faltava era o S.O poder
ESCOLHER — é a diferença entre um sistema operacional e um formulário com um
campo de texto em cima.

`RouteHubRequestUseCase` roda em `hub.fast` com o prompt mínimo: a frase do
usuário e uma linha por operação. **E só quando existe decisão a tomar** —
escopo com uma operação só, ou mensagem vazia, responde sem chamar ninguém.

Por que chamada própria e não carona na saída da operação (o padrão do `plan` e
do `craftSuggestion`): a carona custa zero no caminho feliz, mas o turno
desperdiçado seria o CARO — 8 a 16 mil tokens de `hub.reasoning` já gastos para
descobrir que a pergunta era para outro. A decisão de rota precisa de uma
fração desse contexto, e sai antes de qualquer coisa ser paga.

Por que modelo e não regra: separar "me dá uma dica" de "cria a campanha" é
semântico, e este repositório já pagou para aprender que heurística sobre
palavra erra — foi por isso que `intent` virou decisão do modelo. Rotear é a
mesma classe, um degrau acima: `intent` responde SE muda, o roteamento responde
O QUE está em jogo.

**Pergunta, dica, recomendação e análise são roteadas para quem LÊ mais.** A
instrução manda escolher pelo CONTEXTO que a resposta exige, e lembra que isso
não obriga a mudar nada — cada operação decide depois, no `intent`. Na dúvida
entre duas, vence a que lê mais e muda menos: responder bem sobre o que existe
é recuperável, alterar o que ninguém pediu não é.

**`purpose` entrou porque `label` não serve para escolher.** `label` é progresso
("Refinando o perfil do projeto") — diz o que está acontecendo, não o que a
operação é CAPAZ de fazer. Toda operação declara o seu, e há teste que falha se
alguém acrescentar operação sem ele: sem `purpose` ela entra na lista muda e
nunca é escolhida.

**Nome inventado não vira operação**, e a troca NUNCA é silenciosa: o painel
recebe `OPERATION_ROUTED` logo depois do rótulo, com o que o S.O entendeu.
Trocar em silêncio seria o mesmo defeito com o sinal invertido.

`resolveOperation` continua existindo e continua sendo determinístico — é ele
que RECUSA operação inexistente e operação de outro escopo, antes de qualquer
chamada paga. O que saiu foi o 422 "informe qual operação executar": devolver a
ambiguidade ao cliente nunca foi resposta.

**E o chip morria tarde demais.** Ele era limpo por ESCOPO, mas
`/projetos/:id` e `/projetos/:id/campanhas` são o MESMO `PROJECT:<id>` — o chip
atravessava a navegação entre elas, e foi exatamente por aí que `refinar perfil`
chegou na tela de campanhas. A régua certa não é o escopo, é a OFERTA: operação
que a tela atual não oferece é sobra da anterior, não escolha do usuário aqui.
Lista vazia não limpa nada — significa workspace carregando.

**O S.O DEIXOU DE SER UM ASSISTENTE DE PÁGINA.** Ele agia pela TELA: para
entender que se falava de um projeto era preciso NAVEGAR até o projeto; na tela
do agente ele só sabia de agentes. Um sistema operacional não pede que você
abra a pasta certa antes de mandar copiar um arquivo — ele resolve de que
arquivo você falou.

Três cercas caíram, e as três eram a mesma cerca.

**A operação vinha do CHIP**, não do pedido — ver a nota do roteamento acima.
Agora as candidatas são TODAS, sem filtro de escopo: pedir um projeto estando
no agente cria o projeto.

**O ALVO vinha da URL.** Agora sai do INVENTÁRIO da conta
(`account-inventory.ts`): o nome que o usuário escreveu vira id. A rota vira
PISTA — "ele", "essa campanha", "aqui" sem nomear nada é quase certo que fala
do que está na tela; nome explícito vence a tela, sempre.

**O CONTEXTO era o recorte da tela.** O inventário entra como bloco em TODA
operação, com prioridade baixa e não-essencial: é o bloco mais barato do prompt
(id, nome e uma linha por entidade) e o que mais muda o que ele consegue
responder. O que não estava no contexto virava ausência, e a ausência virava
fato — foi assim que ele afirmou que a conta não tinha agente nenhum.

**A checagem de ESCOPO da rota saiu, e o que a substituiu é mais forte.** Ela
protegia contra cliente com estado velho rodando a operação de uma tela com o
id de outra, mas fazia isso proibindo o S.O de agir fora da tela. Agora o alvo é
conferido contra o inventário POR TIPO: id inventado não está lá, e id do tipo
errado está na lista errada. Id de agente numa operação de projeto é descartado,
e o da tela assume no lugar quando serve.

**ELE PERGUNTA EM VEZ DE ADIVINHAR.** "Ajusta o agente" numa conta com quatro
agentes não tem resposta única, e adivinhar reconfigura o errado em três de
quatro vezes — num documento que o usuário nem estava olhando. O roteador
devolve `question`, e `runner.answer` entrega isso como um turno normal: mesma
mensagem gravada, mesmo canal de eventos, nenhuma operação executada. Custa o
que o roteamento já custou.

**E o S.O LEVA O USUÁRIO ATÉ O QUE ELE MEXEU.** Agindo fora da tela, o
resultado passa a acontecer onde o usuário não está olhando — ele leria "criei
o projeto" com a tela do agente na frente. A navegação acontece quando o
trabalho TERMINA e só quando o destino difere de onde ele já está.

**A FORMA DA RESPOSTA É INFORMAÇÃO** (seção `presentation`, na base). Tudo o
que o S.O dizia chegava como um parágrafo só: um comparativo entre dois agentes
virava prosa corrida e reconstruir a tabela ficava por conta do usuário — no
painel em que ele foi justamente comparar e decidir. `RichText` renderiza
título, lista, TABELA, citação, código e ênfase, e a policy diz quando cada
forma cabe: tabela é para COMPARAR, e um item só numa tabela é um parágrafo com
bordas.

**O renderizador é escrito à mão, e isso é SEGURANÇA — não economia de
dependência.** Ele mostra texto de um modelo que leu site, PDF e conversa de
terceiro: tudo o que o sistema já trata como UNTRUSTED. Um renderizador de
markdown genérico aceita HTML embutido e depende de sanitização correta para
não virar XSS. Aqui nada é interpretado como HTML: cada pedaço vira nó React
com texto, e o que não for reconhecido aparece como o texto que é. Não existe
`dangerouslySetInnerHTML` no arquivo, e há teste que falha se um `<img onerror>`
chegar ao DOM.

**O que NÃO foi feito, de propósito: SQL escrito pelo modelo.** Consulta livre
ao banco quebraria as invariantes 1 e 3 de uma vez — o tenant guard é
fail-closed e `$queryRaw` é barrado por lint justamente porque escapa dele. Uma
consulta gerada por modelo não tem como ser provada segura antes de rodar, e o
que ela pode vazar é a conta de outro cliente. O acesso ao banco existe e é
real: o inventário, `project.workspace`, `agent.field_evidence` e as métricas —
tipados, com `accountId` no `where`, e conferíveis.

**TIRAR A CERCA ABRIU QUATRO BURACOS, e três eram graves.** Estão corrigidos, e
ficam escritos porque todos vieram da MESMA causa: enquanto o alvo vinha da URL,
a rota GARANTIA um id, e várias partes do sistema dependiam disso sem dizer.

**`requiresTarget` — a pior delas.** O runner trata `existing === null` como
CRIAÇÃO. Com o alvo resolvido pelo S.O, "não consegui achar o projeto" passaria
por ali como "não existe projeto", e um pedido de AJUSTE criaria um projeto
NOVO — que o usuário descobriria pela lista, sem ligação com o que pediu. As
sete operações que ajustam declaram `requiresTarget`, e a trava vive NO RUNNER:
é invariante do pipeline, não pode depender de quem chama ter acertado. O
roteador também pergunta antes, para não pagar uma operação inteira só para
falhar.

**Criação não recebe alvo, nem quando o escopo dela tem tipo.**
`playbook.create` é escopo PLAYBOOK e CRIA: `targetKindOf` resolvia a chave de
um ofício EXISTENTE, e "escreve um ofício para X" passaria a reescrever o de
outro papel — o piso de todo agente daquele papel, em toda conta. O escopo não
separa criar de ajustar; `requiresTarget` é a única declaração confiável.

**`humanSummary` era `.max(2000)` CRU, e eu tinha acabado de mandar o modelo
escrever tabelas ali.** É o terceiro campo desta base a repetir o mesmo erro,
depois de `plan` (80) e `interpretedIntent` (300): limite arbitrário que RECUSA
a saída inteira e custa um turno pago. A coluna é `Json` — não havia razão de
banco para 2000. Virou `narrativeField(6000)`, que trunca por `z.preprocess`.
Quem respeita o teto é o CÓDIGO, cortando; nunca o modelo, acertando.

**Navegar automaticamente PRENDIA o usuário na tela.** `state.entity` sobrevive
ao fim do turno e `pathname` está nas dependências do efeito: quem tentasse sair
refazia a condição "destino ≠ onde estou" e era trazido de volta, a cada
tentativa. Um `ref` navega UMA VEZ por entidade e é solto quando o próximo
trabalho começa. O que salva o caso do turno seguinte ser uma pergunta é o
reducer: `request.sent` já zera `entity`.

**E o turno de RESPOSTA não podia emitir em segundo plano.** `resume` faz isso
porque uma operação leva de 8 a 40 segundos e o painel precisa ver o trabalho
acontecendo. `answer` não tem trabalho: termina em milissegundos, antes de o
cliente abrir o stream. Os eventos iriam para o barramento sem ninguém ouvindo,
e o replay não salvaria — `appendEvent` BUFERIZA e só grava no `finish`, então
existe uma janela em que o cliente conecta, o replay volta vazio, e o painel
gira para sempre. Concluindo antes de responder não há janela.

**"O MODELO ESTÁ SOBRECARREGADO" ERA MENTIRA — e o vigia é que estava errado.**
O usuário passou a ver isso o tempo todo, em tudo. O banco desmentiu a
mensagem: **toda** falha tinha `in0/out0`, nenhum token produzido, e os tempos
eram constantes demais para vir do provider — `validation.fast` sempre ~6,1s,
`agent.runtime` ~8,8s (4s + 4s da repetição), `hub.fast` ~12,9s. Isso não é
provider ocupado; é o NOSSO vigia de silêncio desistindo.

**`CHAT_FIRST_TOKEN_TIMEOUT_MS` estava 357ms abaixo da cauda saudável.** A
distribuição medida e escrita aqui é 790 · 833 · 897 · 953 · 1.144 · 1.376 ·
**4.357** ms, e só depois o grupo morto (14.537 · 27.507 · 30.017). O corte
estava em 4.000. O pedido ia responder, era abortado, e o refeito pagava o
prompt de novo — para no fim entregar erro. Passou para **8s**, que fica no
VAZIO entre os dois grupos: continua cortando a cauda morta muito antes dos 14s
em que ela se revelaria, e não encosta na saudável.

O erro aqui NÃO é simétrico, e é por isso que ele passou despercebido: apertado
demais, pagam-se dois pedidos e entrega-se erro por um que ia responder;
folgado demais, esperam-se alguns segundos a mais numa minoria de turnos.

`hub.fast` e `validation.fast` tinham o mesmo defeito (6s de vigia, 1,6s de
margem sobre a cauda saudável) e foram para 8s — o teto do auditor subiu junto,
para 11s, mantendo a promessa que importa: com `MIN_TIME_TO_RETRY_MS` de 5s a
repetição continua não cabendo, então ele nunca segura o turno do usuário.
Medido antes da correção: **6 de 7 auditorias falhando**, cada uma gastando um
pedido para devolver "checagem indisponível".

**O que revelou tudo isso foi o roteamento.** Ele acrescentou um pedido por
turno; a taxa de falha por pedido não mudou, mas a chance de o usuário ver uma
falha por AÇÃO subiu, e o defeito que estava diluído virou constante.

**E o roteador carregava 3.600 tokens para escolher um nome.** Eu tinha
mandado `core`, `information_level` e `diagnosis` — orientação sobre COMO
ESCREVER CONTEÚDO, numa chamada que não escreve conteúdo nenhum. Eram dois
terços do pedido. Isso pesa três vezes: gasta token em toda mensagem do painel,
adia o trabalho de verdade, e aumenta a chance de travar antes da primeira
palavra. Sem policy, o bloco (operações + inventário + instrução) dá ~1.100. O
que o roteador precisa saber está no `purpose` e no inventário.

**Travamento ganhou mensagem PRÓPRIA.** "Sobrecarregado" é uma afirmação sobre o
provider e só se sustenta quando ELE a fez — um 503 ou 429. `StalledError` é o
contrário: o provider nunca respondeu nada, quem desistiu fomos nós. Enquanto os
dois tinham o mesmo texto, vigia mal calibrado aparecia na tela como culpa do
Google — e foi exatamente assim que este número ficou errado sem ninguém ver.

**A CAMPANHA ERA O ÚNICO NÍVEL SEM FORÇA VINCULANTE — e isso explicava a
regressão.** O agente atua em três níveis SOMADOS (base + projeto + campanha), e
o bloco `REGRAS INEGOCIÁVEIS` reunia os dois primeiros e parava aí. Uma regra de
campanha marcada como OBRIGATÓRIA ficava enterrada em "Regras válidas só aqui",
com exatamente o peso de uma preferência. É o mesmo bug que já custou caro no
agente e no projeto, repetido no nível mais ESPECÍFICO — o único em que o
usuário está olhando quando testa uma campanha.

O efeito era o pior possível para o produto, e é o que o usuário relatou:
ajustar pela campanha parecia não funcionar, então a correção migrava para a
BASE do agente — e aí o comportamento mudava em TODAS as campanhas, inclusive
nas que já estão no ar e que ele não está olhando. A saída nunca foi escrever na
base; era a campanha VALER. As facetas de conduta da campanha
(`discoveryDimensions`, `strategy`, `conversionBehavior`, `knowledgeScope`,
`rules`) sobem agora para o bloco vinculante e SAEM da seção da campanha, pela
mesma razão de sempre: dito duas vezes, a segunda ocorrência enfraquece a
primeira. `audience` fica de fora — é descrição de com quem se fala, não uma
ordem, e sob "VOCÊ SEMPRE FAZ" produziria uma linha que não manda fazer nada.

**E o S.O escolhia o nível errado porque ninguém tinha contado a ele que
existem níveis.** O roteador ganhou a régua — que é a MESMA já escrita na
policy: *"isto continuaria valendo se o mesmo agente fosse usado em outra
campanha, de outro produto, para outro público?"*. Não continuaria → campanha.
Só neste negócio → projeto. Sempre → base.

Testando uma campanha e reclamando do que o agente disse ali — abertura,
pergunta vaga, ter proposto antes de descobrir —, o padrão é a CAMPANHA. Só sobe
para a base quando o usuário disser que vale em todo lugar, ou quando o que
falhou não existe no nível da campanha (o jeito de escrever dele, um limite de
ofício, quem inicia a conversa).

O `purpose` das duas operações passou a dizer isso, porque é por ele que o
roteador escolhe: o da campanha declara que ela guarda CONDUÇÃO; o do agente
avisa que o que está lá vale em todo projeto e toda campanha. E a seção
`information_level` da Master Policy ganhou a metade que faltava — ela cobria
onde mora um FATO e não dizia nada sobre onde mora uma CORREÇÃO.

**A COLEIRA DA REPETIÇÃO É LONGA; a da primeira tentativa é curta.** As duas
esperas nunca valeram a mesma coisa, e usar o MESMO número nas duas era o que
fazia um turno travado custar quase dez segundos — sentido justamente no Lab
pelo projeto e pela campanha, onde o prompt é ~3,5k contra ~1,3k da base.

Medido em `ai_calls`, com 8s nas duas: os turnos lentos formavam um agrupamento
apertadíssimo em **9.577 · 9.637 · 9.725 · 9.783 · 9.812 · 10.059 ms**, contra
uma mediana de ~1s nos demais. Isso não é variação do provider: é 8s de vigia
mais ~1,5s da repetição, em quase metade dos turnos. E `reasoningTokens` era 0
em todos — não era raciocínio; era travamento puro.

Abandonar a PRIMEIRA tentativa é barato: ela não produziu token, logo não foi
cobrada, e refazer custa só tempo. Abandonar a SEGUNDA é caro — devolve erro
depois de o usuário ter esperado duas vezes. Então 6s na primeira (acima da
cauda saudável mais lenta já observada, 5.650ms) e 20s na repetição: o mesmo
turno travado sai em ~7,5s e a repetição praticamente não falha mais.

Isto fecha uma sequência de dois erros no mesmo número: 4s matava pedido
saudável (a cauda encosta em 4.357ms), 8s consertava isso e criava a espera
dupla. A resposta nunca foi escolher entre os dois — era parar de usar um número
só para duas decisões diferentes, exatamente como `essential` separou ordem de
proteção no compilador de contexto.

**E o layout: prender o SHELL não bastava.** `h-dvh overflow-hidden` no shell
tratava o sintoma; a causa era `html`, `body` e `#root` sem altura declarada,
então o DOCUMENTO crescia e rolava junto — a tela subia e deixava uma faixa
vazia embaixo. A trava tem que estar onde a rolagem acontece: `height: 100%` nos
três e `overflow: hidden` no body. O portão de login é a única tela fora do
shell e ganhou rolagem própria — com o documento travado, `min-h-full` sozinho
cortaria o formulário numa janela baixa, e é exatamente ali que não se pode
ficar sem alcançar o botão.

**O AUDITOR SEGURAVA A RESPOSTA — e era metade da espera na tela.** Eu tinha
medido a latência do PROVIDER e concluído que estava tudo bem em ~1s; o usuário
via 5s. A conta que faltava era simples: o turno do Lab é uma chamada ao agente
MAIS uma chamada de auditoria, em série, e a fala só aparecia depois das duas.

Medido no banco, emparelhando cada turno com a auditoria seguinte: mediana de
**~1s no agente e ~1,1s no auditor** — ele DOBRAVA a espera. E travando, cobrava
8s a mais para no fim dizer "checagem indisponível": em 5 dos 12 últimos turnos
o usuário esperou 8 segundos extras para ser informado de que nada foi conferido.

A arquitetura já dizia metade disto: *"falha do validador NÃO derruba o turno —
a resposta já foi produzida e já foi paga"*. **Esperar por ele é o mesmo erro,
só que silencioso**: o usuário não vê um erro, vê o produto lento.

Agora o turno volta assim que o agente responde, com `adherence: 'CHECKING'` e o
id da fala gravada. A conferência roda atrás e o selo resolve sozinho —
`conferindo regras…` vira `regras cumpridas`, a violação, ou `indisponível`.
Desistir NUNCA vira selo verde: não saber não é aprovar, e confundir os dois é
exatamente o que já pintou verde sobre um validador morto.

**O estado da conferência vive em MEMÓRIA; as violações continuam gravadas.**
Elas são o dado — o transcrito restaurado depois de um F5 precisa delas. O
estado é interface e morre com a tela; persistir pediria coluna nova para algo
que ninguém lê depois. Reiniciar o processo perde vereditos em voo, e o custo é
o selo dizer "indisponível" — que é a verdade.

E a escrita tardia é `updateMany` com `accountId`, com os eventos saindo só das
violações NOVAS: `recordTurn` já emitiu um evento por violação determinística, e
reemitir a lista inteira contaria as mesmas duas vezes num dashboard que agrega
por checker.

**NOME DE NEGÓCIO NÃO ENTRA NA BASE DO AGENTE — e quem garante é o código.**
Pedido de dentro de um projeto, o S.O criou "Sankar Atendimento", com objetivo
"qualificar demandas da Linha Industrial Sankar", e no ajuste seguinte pôs a
campanha numa skill. A policy já dizia que o agente é da conta; a conversa
falava daquele negócio e venceu — e a instrução de criação ainda mandava
derivar o nome "do negócio descrito". Os nomes de projeto e campanha são um
fato que o domínio conhece (inventário), então `findLevelLeaks`
(`level-leak.ts`) os procura no que o modelo escreveu: acusando, UMA correção
com o termo e o campo exatos (forma do `schemaCorrection`); persistindo, só o
item contaminado é descartado, com aviso. O alvo declara `levelBoundary`, sem
`if` por tipo no runner. Casa o nome como NOME — grafia cadastrada ou caixa
alta, palavra inteira: um projeto "Consultoria" não pode acusar "consultoria".

**A FRONTEIRA DO S.O É A FRONTEIRA DO SISTEMA.** Pedido "vincula ele no
projeto Sankar", com o agente nomeado, o S.O respondeu explicando onde clicar:
ele só sabia MUTAR canônico, e tudo o que a tela faz fora disso — vincular,
publicar, conhecimento, excluir, sincronizar ofício, trocar modelo — estava
fora do alcance dele. Agora são AÇÕES DO SISTEMA (`system-action.ts`): o
roteador escolhe ação ou operação no mesmo campo, resolve os ids pelo
inventário, e `runner.act` executa pelo MESMO use case da rota (a lógica que
morava dentro das rotas virou use case: `BindCampaignAgent`, `SyncAgentCraft`,
`ChangeModelRoute`). Sem `hub.reasoning`: a frase do resultado sai do código.
Irreversível passa por "confirma?" — o roteador recebe as últimas falas para
entender o "sim". **`system-action.test.ts` varre as rotas de escrita e falha
se uma nova não disser qual ação ou operação do S.O faz a mesma coisa.**

**O ROTEADOR FICOU CEGO, E NADA ACUSOU.** Acrescentei ações ao catálogo, o
bloco único dele passou do teto de 3.000 e o `ContextCompiler` o cortou
inteiro: 10 tokens de entrada em `ai_calls`, o modelo decidindo só com a frase
do usuário — "qual o identificador do agente?" numa conta com um agente só.
Três correções: o bloco é `essential`; o compilador NUNCA corta o bloco de
maior prioridade (prompt acima do teto é caro, prompt vazio é errado); e
candidato único se resolve em código (`onlyOne`), sem pergunta. **Ao mexer
num prompt, confira `inputTokens` em `ai_calls` — queda brusca é corte.**

**`listMessages` devolvia as PRIMEIRAS N falas** (`asc` + `take`). Numa conversa
longa, o runner mandava o começo dela como "histórico recente" e o roteador
não via a pergunta a que "o único que tem" respondia. Agora: as últimas N, em
ordem, com `id` desempatando o mesmo milissegundo.

**O S.O NÃO REDIRECIONA — e não há mais checklist.** Duas notas acima estão
REVERTIDAS. A navegação automática ao fim do turno tirava o usuário da tela em
que ele estava testando (ajustar a saudação pela campanha levava ao agente); o
resultado agora diz em que CAMADA valeu ("Base do agente Alex · vale em todas
as campanhas") com um link, e ninguém sai de onde está. O `plan` saiu das
saídas: o checklist aparecia em todo pedido, com dois itens genéricos durante o
trabalho. No lugar: uma linha viva com o último fato do log, e o log recolhido
sob "processo".

**O número de tokens do turno é o turno INTEIRO.** Faltavam o roteamento (um
ajuste de 21.181 aparecia como 17.528) e a tentativa recusada da correção de
schema. `priorCost` leva o roteamento à operação; o gateway soma a recusada.

**O S.O CARREGA SÓ A ORIENTAÇÃO QUE O PEDIDO USA** (`request-signals.ts`). O
roteador já lê a frase: devolve `signals` (FAILURE_REPORT, EXAMPLE,
INTERLOCUTOR) e as seções situacionais da policy (`diagnosis`,
`calibration_level`, `examples`, `ephemeral_facts`) só entram com o sinal
delas. Sem sinais conhecidos (roteador não rodou), entra TUDO — o padrão
seguro. Medido: policy de pedido comum 6.916 → 3.468.

**Economia sem perda de decisão, medida:** roteador 3.608 → ~1.950 tokens
(instrução reescrita sem repetir a regra de nível; inventário com APELIDOS —
P1, A1, C1 — traduzidos de volta para id em código; ULID de 26 caracteres não
entra mais no prompt dele). Canônico no prompt via `promptJson` (sem
indentação e sem `createdAt`/`updatedAt`/`originHubMessageId`/`rationale`):
2.398 → 1.457. Instrução do ajuste sem a régua de criar do zero
(`CRAFT_ADJUST`): 2.753 → 1.974. Respostas do S.O voltam cortadas no histórico
(500 caracteres) — as falas do usuário vão inteiras. `diagnosis` e
`calibration_level` perderam a narrativa (a história mora aqui, não no prompt).

**ENXUGAR O ROTEADOR QUEBROU UM CASO QUE FUNCIONAVA, e nada acusou.** Numa
conta vazia, "crie um projeto a partir deste link" virou "não identifiquei qual
projeto": o link na frase levou o modelo a escolher CADASTRAR A PÁGINA no
conhecimento de um projeto que não existia. Duas mudanças minhas somaram: o
prompt mais curto e o painel parando de mandar a ação da tela como pista. A
suíte não pega isso — ela roda contra o Fake. Por isso existe `smoke:routing`,
com este caso dentro. Correções: ação sobre um tipo que a conta NÃO TEM vira a
operação que cria aquele tipo (código, não instrução); a ação da tela volta a
ir como pista, e `operationPicked` separa pista de escolha (só a escolha
justifica anunciar "entendi diferente").

**RELATO DE ERRO É PEDIDO DE CORREÇÃO — mesmo terminando em "entendeu?".** A
seção `conversation` mandava "na dúvida, RESPONDA", e o S.O explicava o erro do
agente sem corrigir. Agora ANSWER só vale em três casos, e dois deixam rastro:
dúvida pura; não saber O QUE mudar (vira `gaps`); o sistema não permitir (vira
`limitation`). A garantia é código: roteador marcou FAILURE_REPORT, operação
respondeu sem `gaps` nem `limitation` → UMA revisão (`FAILURE_REPORT_CORRECTION`).

**O QUE O S.O NÃO ALCANÇA VIRA PAUTA DE SUPORTE** (`system_limitations`,
`/admin/suporte`). `limitation` viaja em toda saída (junto do `intent`); o
runner grava e avisa ("Registrei para a equipe do MyAIHub"). Leitura e
resolução do admin em escopo elevado, com auditoria — resolver exige dizer o que
foi feito.

**ESCREVER INSTRUÇÃO NÃO CRIA CAPACIDADE** (seção `system_capabilities`, na
base). Pedido "ele manda o orçamento por e-mail", o S.O gravou "dispara o
orçamento por e-mail" e disse "ajustei" — o agente passaria a prometer ao
cliente um e-mail que nunca chega. A seção lista o que o runtime do agente FAZ
(texto, imagem recebida, conhecimento, CTA como link, respostas rápidas,
abertura) e o que NÃO existe. Item existente que promete o inexistente é
defeito: reescreve no mesmo turno (regra no contrato de saída do ajuste, onde
ela pega — na policy sozinha, não pegou). **Ao dar capacidade nova ao agente,
atualize esta seção.**

Operação que precisa de alvo, numa conta sem NENHUM daquele tipo, cai na
operação que lê a entidade da tela — "qual campanha?" a quem não tem campanha
é pergunta sem resposta, a mesma classe do "qual projeto?" da conta vazia.

**O LEITOR DE PÁGINAS JOGAVA FORA A IDENTIDADE VISUAL.** `<style>` e `<script>`
eram removidos como "payload de injeção" e todo atributo virava espaço: sobrava
TEXTO. Então o S.O descrevia o negócio a partir do site e não tinha como saber
de que cor ele é — e o chat publicado saía com a cara do MyAIHub para quem
clicou num anúncio daquela marca. `visual-identity.ts` mede cor (com FREQUÊNCIA
e PAPEL — a mesma cor em `background` e em `color` diz coisas opostas), fonte,
raio e logo, inclusive nas folhas de estilo EXTERNAS, que é onde a marca mora em
site feito com framework. Cada folha passa pela MESMA validação de SSRF: um
`<link href>` é uma URL escolhida por terceiro, e confiar nela porque a página
passou reabre o buraco. Medido no site real: `theme-color #013d90`, Montserrat,
Outfit, raio de 16px.

**COLETA É CÓDIGO; INTERPRETAÇÃO É DO MODELO.** Contar ocorrência de cor é
mecânico e conferível; dizer qual delas é "a da marca" é leitura. O modelo lê a
medição e devolve `SET_BRAND_IDENTITY` tipada, como qualquer outra mutação
(invariante 6). Medido: o site serve a paleta inteira do Bootstrap (`#0d6efd`,
`#dc3545`, …) e o modelo escolheu o `#013d90` da `theme-color`, que é o azul
real da empresa.

**Fonte de ÍCONE não é fonte de marca.** O mesmo `<link>` trazia `Montserrat` e
`Material Symbols Outlined`; sem filtro, a segunda entra com o mesmo peso — e
uma página de atendimento escrita em pictogramas é uma falha que ninguém testa
antes de publicar.

**A PÁGINA PÚBLICA VESTE A MARCA INTEIRA, não a faixa do topo.** Só o `<header>`
recebia a cor: balão, chip, fundo, botão e fonte continuavam nos tokens do
MyAIHub. A correção não é pintar componente por componente — é redefinir as
MESMAS variáveis de tema no escopo da página (`brandCssVariables`). Todo
componente já lê `--color-accent`, `--font-sans` e `--radius-card`, então passa
a vestir a marca sem saber disso, inclusive os que ainda não existem.

**A FONTE É UM NOME, nunca uma URL.** Repetir o `<link>` do site seria aceitar
um recurso externo escolhido por terceiro — ou pelo modelo que leu esse
terceiro. O canônico guarda a FAMÍLIA, validada contra `[A-Za-z0-9 -]`, e quem
monta a URL do provedor é `googleFontsHref`. `source: 'SYSTEM'` significa "não
baixe nada", que é o certo para Arial e afins.

**Contraste agora é VERIFICADO, não só preenchido.** A cor sobre a primária
continua sendo calculada quando falta; o par texto/superfície é CONFERIDO contra
o piso da WCAG e corrigido se reprovar, porque essa paleta pode vir de uma
varredura — fundo e texto colhidos de regras CSS diferentes, sem garantia de que
conviviam no mesmo lugar. 4,5:1 no texto, 3:1 no secundário.

**O AGENTE APRESENTA, não só escreve** (`§VISUAL§`, ligado por agente). Fluxo de
etapas, comparativo, pontos, cartões de escolha, ficha e destaque. Mesma solução
das respostas recomendadas — marcador DENTRO da fala que ele ia escrever de
qualquer jeito, custo marginal zero — e UM marcador com um tipo, porque cada
símbolo novo na instrução disputa atenção. O bloco FICA no texto salvo, ao
contrário da sugestão: recarregar restaura a estrutura, e as regras
determinísticas leem a fala inteira. Sem isso bastaria pôr "entrega em 3 dias"
dentro de uma célula para escapar de uma regra que proíbe prometer prazo.

**O gatilho é a FORMA da frase, de novo.** "Explica o processo" produziu o fluxo
na primeira tentativa; "qual a diferença entre A e B" não produziu tabela
nenhuma, porque a instrução dizia "as mesmas perguntas respondidas para 2 ou 3
opções" — abstrato. Trocada por *"se a pergunta tem a forma 'qual a diferença
entre A e B', a resposta é um comparativo"*, a mesma pergunta virou tabela.
Terceira vez que este repositório paga por regra escrita como conceito em vez de
como forma reconhecível.

**Recurso novo NÃO liga sozinho em agente que já existe.** `visualBlocksEnabled`
tem default `false` no schema e `true` em `emptyAgent()`. O schema é lido sobre
documentos JÁ GRAVADOS: um default `true` ali faria todo agente existente mudar
de comportamento na próxima leitura, sem ninguém pedir, e quem descobriria seria
o cliente dele.

`npm run scan:site <url>` mede um site sem passar pelo modelo — separa "a
extração não achou" de "o modelo leu errado". `npm run smoke:brand` faz o
caminho inteiro contra o Gemini real e falha se a identidade continuar no padrão.

**"PASSOS" NUMERADO NÃO LÊ COMO SEQUÊNCIA — testado com usuário real.** A
primeira versão numerava cada linha mas separava com borda horizontal, e a
reação foi "não diria que está errado, mas uma lista não ordenada se associa
mais a tópicos". O número sozinho não bastava; era a LINHA conectando os
círculos que faltava — o mesmo círculo com uma haste vertical até o próximo lê
como fluxo, sem ela lê como lista empilhada. Correção estrutural, não de texto.

**O ÍCONE É ESCOLHA DO MODELO, DENTRO DE UM VOCABULÁRIO FECHADO** (`VISUAL_ICONS`,
pacote compartilhado). Igual à `semanticKey` do canônico e ao `kind` da mutação:
nome fora da lista não quebra a linha, ela só fica sem ícone — nunca uma
resolução dinâmica de componente a partir de texto de um modelo, que seria a
mesma classe de risco que `RichText` já recusa. O ícone entra como a PRIMEIRA
célula da linha (`passos`, `pontos`, `opcoes`, `destaque`); `ficha` e
`comparativo` não aceitam — um é dado, o outro é tabela, e ícone por critério
competiria com as colunas.

**"PONTOS" GENÉRICO NÃO CARREGA VALOR — testado com usuário real.** Perguntado o
diferencial da empresa, o agente respondeu com a mesma lista de bolinhas de
qualquer item solto — "não diria que está errado, mas... deveria ser mais
próximo de uma referência visual". A resposta não foi criar um componente novo
para "diferencial": foi deixar o MESMO `pontos` aceitar ícone por linha, e
quando pelo menos uma linha tem, o item vira uma placa (ícone em quadrado,
título em destaque) em vez de bolinha. Um componente, dois pesos — o conteúdo
decide, não uma categoria nova disputando com as seis que já existem.

**COMPARATIVO NUNCA FOI TABELA — é CARTÃO por opção.** A primeira versão era uma
`<table>` com `overflow-x-auto`: correta no conteúdo, ruim no celular — rolagem
horizontal ou texto espremido numa coluna estreita. Testado num viewport de
telefone real, a orientação foi "fugir da rolagem horizontal sempre que
possível, e nem comprimir o texto". Uma tabela mais inteligente não resolve
isso — o formato errado é a tabela em si. Cada opção virou um cartão com os
critérios como pares rótulo/valor, que quebram linha livremente; empilhados no
celular, lado a lado a partir de `sm`. Zero rolagem, zero compressão, medido.

**O ÍCONE EXISTIA E NÃO TINHA PESO PARA SER NOTADO.** Testado com usuário real:
"nem ícones semânticos... estão aparecendo" — o selo media `size-8`/`size-4` e o
texto ao lado dominava a leitura. Duas correções, e as duas eram necessárias: o
selo cresceu para `size-9`/`size-[18px]`, e a instrução deixou de dizer "sem
ícone que caiba bem, omita" (permissiva demais — o modelo omitia com
frequência) para "toda linha começa com ícone; `star`/`check` cobrem o que
sobrar". Regra frouxa produz omissão; regra que sempre tem uma saída válida
produz o ícone.

**PSICOLOGIA DA COR NUNCA PODE SER UM VERDE/VERMELHO DE BIBLIOTECA.** Pedido
explícito: vantagem/desvantagem num comparativo em verde/vermelho, MAS dentro
da paleta que o cliente aprovou — nunca o `--color-success`/`--color-danger`
internos do MyAIHub vazando pra dentro do chat de outra marca. A resposta foi
os mesmos campos entrarem na IDENTIDADE (`colors.success`/`colors.danger`,
editáveis na tela, extraídos do site quando ele já sinaliza uma cor de
confirmação/erro) e `brandCssVariables` sobrescrever os tokens dentro do escopo
da página pública — a mesma mecânica que já veste `--color-accent`. Sem default
calculado a partir da primária: verde/vermelho "puxados" de um azul saem
dessaturados demais para funcionar como sinal.

**REGRA DE COMPARATIVO QUE SOBREVIVEU A TRÊS REDAÇÕES E CONTINUOU FALHANDO —
mesma lição, testada de novo.** Pedido: marcar vantagem "+ " E desvantagem "- "
nas duas colunas do mesmo critério. O modelo marcava de bom grado o lado
favorável e parava — o desfavorável ficava sem marca mesmo pedindo
explicitamente as duas, em três formulações (concreta com exemplo, "os dois
lados quase sempre", mecânica "decida por linha"). A saída não foi uma quarta
frase: com só DUAS opções, "o oposto de +" tem resposta única, então o DOMÍNIO
infere (`inferirOposto`) o lado que faltou, sem pedir mais nada ao modelo. Com
três ou mais opções a inferência não roda — não existe "o oposto" de uma
entre três, e inventar seria pior que ficar neutro.

**O CHAT PÚBLICO NÃO TINHA A SUAVIDADE DO LAB.** A resposta "brotava" inteira na
tela — o Lab já revelava caractere a caractere (`useTypewriter`, 45 char/s, teto
de 900ms) e o chat público nunca ganhou o mesmo tratamento. Extraído para
arquivo próprio porque as DUAS telas precisam do mesmo efeito; duas
implementações divergiriam no primeiro ajuste de ritmo. As respostas
recomendadas só aparecem quando a revelação TERMINA — mostrá-las antes seria
oferecer atalho para uma resposta que o visitante ainda não terminou de ler, e
é a mesma regra que o Lab já tinha.

**A CHAVE DE CADA PROVIDER VIROU TELA, NÃO SÓ `.env`** (`ai_provider_credentials`,
`ai_provider_settings`, `/admin/provedores`). Antes, trocar a chave da OpenAI
exigia editar `.env` e reiniciar o processo — e ligar/desligar um provider não
existia como ação nenhuma. `ProviderRegistry` substitui `createProviders()` e
recarrega a cada escrita do admin, pela MESMA razão que `ModelRouteStore` já
recarrega: uma tela de gerenciamento que só funciona depois de reiniciar não
gerencia nada. A `.env` continua existindo — é usada só para SEMEAR o banco na
primeira vez que ele estiver vazio, nunca mais depois disso.

**A CHAVE É CIFRADA COM UMA CHAVE DERIVADA, NÃO UMA NOVA VARIÁVEL DE AMBIENTE.**
`CredentialCipher` deriva a chave de cifra de `JWT_ACCESS_SECRET` via `scrypt`,
com um sal fixo próprio deste uso. Pedir uma variável nova só para isto
quebraria a promessa de que o boot nunca exige configuração além do que já
existe — e o segredo que já protege toda sessão é exatamente do tamanho e do
sigilo que isto precisa. Nunca sai em texto puro nem para o admin: a tela
recebe só os últimos 4 caracteres (`maskApiKey`).

**A MESMA Map, NUNCA SUBSTITUÍDA — SÓ MUTADA.** `ModelRouter` e as rotas
guardam a REFERÊNCIA do Map de providers, pega uma vez no boot. Doía aqui: o
código antigo tinha um `const geminiProvider = providers.get('gemini')`
capturado À PARTE para ler a cota, e `reload()` trocando a entrada do mapa
deixaria essa referência presa à instância velha — a mesma classe de bug que
`ContextCompiler` já teve com blocos cortados em silêncio. A correção: NINGUÉM
guarda uma referência de provider isolada; todo mundo lê `providers.get(nome)`
na hora, inclusive a closure de cota do `ModelRouteStore`.

**INVARIANTE 8 QUASE MORREU NA REESCRITA.** O `createProviders()` antigo tinha
`if (env.GEMINI_API_KEY && !isTest)` — e essa guarda contra API paga em teste
sumiu na primeira versão do `ProviderRegistry`, porque a checagem de `isTest`
não fazia parte do que eu estava pensando em preservar ao trocar a fonte da
chave de `.env` para banco. Os testes do próprio registro pegaram na hora:
com `isTest` lido direto do módulo de env, o teste que queria provar "gemini
com chave vira instância real" simplesmente não tinha como passar, porque
vitest roda em `NODE_ENV=test`. A correção certa não foi ignorar o teste — foi
INJETAR `isTestEnvironment` como dependência do construtor, em vez de importar
`isTest` fixo: assim dá para testar os dois comportamentos (dentro e fora de
teste) sem um decidir pelo outro.

**OpenAI e Anthropic ACEITAM CHAVE E TESTE, mas não têm adaptador de geração.**
Decisão explícita, para não inflar o escopo de uma tela de gerenciamento de
chaves com dois adaptadores completos (streaming, saída estruturada, retry).
`ProviderRegistry` sempre devolve `UnavailableProvider` para os dois, com a
mensagem distinguindo "sem chave" de "chave cadastrada, falta o adaptador" —
confundir os dois motivos faria o admin achar que cadastrar bastava.
`ChangeModelRouteUseCase` já barrava por `available`, então apontar um papel
para eles continua recusado, sem nenhuma mudança ali.

**"TESTAR CONEXÃO" NÃO GASTA TOKEN.** Cada provider tem um endpoint de
METADADO (listar modelos) que só exige autenticação, nunca gera conteúdo —
`test-connection.ts` usa exatamente esses. As três URLs são FIXAS, escritas no
código; nunca construídas a partir de entrada do usuário, então isto não tem a
superfície de SSRF que `WebContentReader` tem contra site de terceiro.

**CHAVE DE API NÃO PASSA PELO CHAT DO S.O.** As três rotas de gerenciamento de
provider (`PATCH`, `PUT keys`, `POST test`) são EXCEÇÃO em
`system-action.test.ts`, diferente de `model.set_route` (que É uma ação do
S.O.). A diferença: trocar o modelo de um papel não expõe segredo nenhum;
colar uma chave de API na conversa faria ela ser lida por um modelo e
persistida no transcrito — o tipo de coisa que não deveria existir em lugar
nenhum além do formulário que grava direto, cifrado.

**O BADGE DE COTA É SWITCH — e para o ADMIN ele TEM `onChange`.** A troca entre
gratuita e paga é automática por padrão (a cota do dia acaba, o sistema troca
sozinho), mas o admin pode FORÇAR a paga mesmo com a gratuita de pé — a mesma
razão de existir botão de silenciar som ou de trocar chave: às vezes a decisão
é da pessoa, não do sistema. Para quem não é admin o `Switch` continua sem
`onChange`, só ESTADO — forçar o bolso de que sai a conta é decisão de
PLATAFORMA, a mesma fronteira de toda ação do módulo de Provedores.

**`forcedPaid` é separado de `freeBlockedUntil`, e a distinção é a que evita
mentir na tela.** Um é FATO com prazo — a cota esgotou, e ela volta na
meia-noite do Pacífico ou no minuto seguinte, um horário que a tela pode
mostrar. O outro é ESCOLHA sem prazo — só volta quando o próprio admin desligar,
e não existe "volta às HH:MM" para uma preferência. `GeminiKeyRing.select()`
confere a escolha ANTES do bloqueio natural: forçado, a paga vale mesmo com a
gratuita disponível. A escolha vive em `ProviderRegistry.geminiForcedPaid`,
fora do `GeminiProvider` — porque trocar a chave gratuita RECONSTRÓI a
instância do zero, e a preferência precisa sobreviver a isso; se vivesse só
dentro do provider, um ajuste de chave sem nada a ver com a escolha a
desligaria em silêncio.

**O BADGE FICOU "TRAVADO" NA PAGA DEPOIS DE DESLIGAR A FORÇA — porque ele lia
o HISTÓRICO, não o anel.** Forçar a paga, testar uma vez e desligar a força
deixava a tela dizendo "a cota gratuita do dia acabou" mesmo com a gratuita
livre — porque a última linha de `ai_calls` tinha saído pela paga (era
forçada) e o badge derivava "gratuita esgotada" de `servida !== 'FREE'`, sem
saber que aquele PAGA vinha de uma ESCOLHA já desfeita, não de bloqueio real.

Testado com usuário real, com o print do próprio bug. A defesa não é o
histórico ficar mais esperto — é o admin deixar de precisar dele: para quem
PODE forçar, `GET /admin/providers` agora expõe o estado VIVO do anel
(`tier`/`freeAvailableAt`, saídos de `GeminiKeyRing.status()` a cada leitura,
não de `ai_calls`), e o badge do admin usa ESSE tier — o que a PRÓXIMA chamada
vai de fato usar — para decidir a mensagem e a posição do switch. Quem não é
admin continua no histórico de `useSpend()`, porque não tem como forçar nada e
"o que aconteceu" é exatamente a pergunta que faz sentido para ele.
`useProviders({ enabled: isAdmin })` evita bater numa rota `ADMIN`-only a
cada render do badge para quem não é admin.

Ver a tabela de fases em `docs/ARCHITECTURE.md` §15.

**Não implemente fase futura para "parecer completo".** Estado vazio honesto que diz
em que fase a funcionalidade chega é melhor que tela falsa.

---

## Providers

Só o **Gemini** tem chave configurada (`gemini-3.5-flash-lite`, gratuito para dev).
OpenAI e Anthropic ficam sem chave de propósito: precisam ser registrados como
indisponíveis e falhar com `PROVIDER_NOT_CONFIGURED` — **o boot nunca pode quebrar
por falta de chave**.

---

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->