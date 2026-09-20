# MyAIHub

Hub central de operações com Inteligência Artificial de um projeto/negócio.

O usuário administra **significado e intenção**. O MyAIHub administra **a IA e sua
implementação técnica** — prompt engineering, context engineering, schemas, roteamento
de modelos, caching e validação ficam do lado do sistema, não do usuário.

No MVP, o primeiro módulo operacional é **Campanhas**.

> Arquitetura completa, decisões e riscos: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Estado atual

| Fase | Escopo | Situação |
|---|---|---|
| 0 | Monorepo, TS strict, lint, testes, build, Docker, CI | ✅ concluída |
| 1 | MySQL/Prisma, Account/User/Membership, auth, RBAC, tenant guard, seed | ✅ concluída |
| 2 | Design system + App Shell (sidebar empilhada, painel vivo) | ✅ concluída |
| 3 | AI core: providers, Context/Prompt Compiler, SSE, usage, custo | ✅ concluída |
| 4 | MyAIHub OS: policy versionada, operations, mutações tipadas, live events | ✅ concluída |
| 5 | Projects: perfil canônico versionado, capabilities (Flow 1 ponta a ponta) | ✅ concluída |
| 6 | Agents: canônico, versionamento, configuração pelo OS | ⏳ próxima |
| 7–11 | Campaigns → Lab → Public Chat → Métricas → Hardening | ⏳ |

**224 testes** (unitários + integração). Flows 1, 7 e 8 do §72 cobertos ponta a ponta.

Trabalhando com Claude Code neste repositório? [`CLAUDE.md`](CLAUDE.md) traz os
invariantes, as convenções e as armadilhas do ambiente.

---

## Stack

**Backend** — Node 22, Express 5, TypeScript strict, Prisma, MySQL 8.4, DDD + Clean Architecture
**Frontend** — React 19, Vite 7, TypeScript, Tailwind CSS 4, TanStack Query, React Router 7, Lucide
**Infra local** — Docker Compose (MySQL + Adminer)

---

## Começando

Pré-requisitos: **Node 22+**, **npm 10+**, **Docker**.

```bash
# 1. Configuração
cp .env.example .env
#    Preencha GEMINI_API_KEY (e as demais chaves de provider, se tiver).
#    Gere segredos JWT próprios:
#    node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 2. Dependências
npm install

# 3. Rodar — sobe TUDO
#    Garante MySQL e Adminer no ar, aplica as migrações pendentes, semeia
#    os usuários de desenvolvimento e levanta api e web.
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3333
- Adminer: http://localhost:8080

O primeiro `docker compose up` provisiona três bancos:

| Banco | Uso |
|---|---|
| `myaihub` | desenvolvimento |
| `myaihub_test` | testes de integração — é **truncado a cada teste**, por isso nunca aponte `TEST_DATABASE_URL` para o banco de dev |
| `myaihub_shadow` | descartável, usado pelo `prisma migrate dev` para detectar drift |

> Os dois últimos são criados por `docker/mysql-init/`, que só roda na **primeira**
> inicialização do volume. Se você já tinha o volume, recrie com
> `docker compose down -v && docker compose up -d`.

### Tudo em containers

```bash
docker compose up -d
```

Sobe os quatro serviços — `web` só depois de `api` responder saudável, `api` só
depois de `mysql` saudável. Para rodar `api`/`web` no HOST em vez de container
(HMR mais rápido, especialmente no Windows), suba só a infra e use `npm run dev`:

```bash
docker compose up -d mysql adminer
npm run dev
```

---

## Credenciais de desenvolvimento

Criadas pelo `npm run db:seed`, configuráveis por env. **Nunca use estes valores em produção** —
`env.ts` rejeita o boot em produção se as senhas padrão estiverem presentes.

| Papel | E-mail | Senha | Env |
|---|---|---|---|
| `ADMIN` | `admin@myaihub.local` | `Admin@123456` | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |
| `USER` | `teste@myaihub.local` | `Teste@123456` | `SEED_TEST_EMAIL` / `SEED_TEST_PASSWORD` |

O admin tem privilégio global, mas também possui a própria Account e usa o produto
normalmente. Acesso cross-tenant nunca é implícito: exige elevação explícita e é auditado.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API + web em paralelo |
| `npm run build` | Build de shared, api e web |
| `npm run typecheck` | `tsc -b` em todo o monorepo |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest (todos os workspaces) |
| `npm test` sem Docker | Testes de integração são **pulados** com aviso; em CI são obrigatórios |
| `npm run db:migrate` | Cria/aplica migração de desenvolvimento |
| `npm run db:seed` | Popula usuários de desenvolvimento |
| — | Em desenvolvimento o BOOT da API já migra e semeia sozinho |
| `npm run db:reset` | Recria o banco do zero |
| `npm run db:studio` | Prisma Studio |
| `npm run dev` | Sobe tudo: infra, migrações, seed, api e web |
| `npm run docker:up` | Só a infraestrutura + migrações + seed |
| `npm run docker:up:only` | Só os containers, sem tocar o banco |
| `npm run docker:down` | Derruba a infraestrutura |

---

## AI Providers

Arquitetura provider-agnostic: nenhum domínio depende de SDK específico.
Implementados: `FakeProvider` e `GeminiProvider`. OpenAI e Anthropic entram como
indisponíveis até terem chave.

O provider/modelo é escolhido **por role**, configurável por ambiente:

```env
MODEL_ROLE_HUB_REASONING=gemini:gemini-3.5-flash-lite
MODEL_ROLE_AGENT_RUNTIME=anthropic:claude-sonnet-4-5
```

Provider sem chave configurada é registrado como indisponível e falha com
`PROVIDER_NOT_CONFIGURED` — o boot nunca quebra por falta de chave.
O `FakeProvider` é permanente: testes automatizados nunca consomem API paga.

---

## Guardrails de arquitetura

Estes não são convenções de revisão — são regras que quebram o build:

- **Tenant isolation** — `TenantContext` explícito nos use cases, mais um guard *fail-closed* no
  Prisma que **lança** se um modelo tenant-scoped for consultado sem `accountId`.
  Modelo novo sem classificação em `tenant-policy.ts` quebra os testes.
- **Raw SQL barrado por lint** — `$queryRaw` escapa do guard; exceções exigem justificativa
  e teste de isolamento dedicado.
- **Camadas** — `domain/` e `application/` não podem importar Prisma, Express ou SDK de provider.
  Regra de lint, não recomendação.
- **Nada de estado em arquivo** — configuração e estado de sessão vivem no banco. Uploads são
  `MediaAsset`.
- **Segredos fora da imagem** — `.dockerignore` mantém o `.env` fora do build. Os Dockerfiles
  fazem `COPY . .`; sem isso as chaves ficariam legíveis por `docker history`.
- **Auditoria na mesma transação da mudança** — mudança sem rastro e rastro sem mudança são
  igualmente inaceitáveis.

---

## Estrutura

```
apps/api      backend (bounded contexts em src/modules/)
apps/web      painel React + Public Chat
packages/shared  contratos compartilhados (Zod, tipos, enums) — zero lógica
docker/       Dockerfiles
docs/         arquitetura
```
