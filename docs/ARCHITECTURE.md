# MyAIHub — Arquitetura (v0.2)

> Documento de fundação. **Aprovado** — orienta a implementação.
> v0.2 incorpora os ajustes de revisão: deployment imutável, reprodutibilidade completa,
> `ConfigurationChange`, mutações canônicas tipadas, separação dos validadores,
> identidade de itens canônicos, endurecimento de tenant isolation, rastreio de policy,
> segregação de conteúdo untrusted, `FakeProvider` e eliminação do módulo `platform`.

---

## 1. Princípios que governam todas as decisões

1. **Banco é a fonte da verdade.** Prompt é artefato efêmero compilado em runtime.
2. **Configuração canônica ≠ prompt.** Existe um documento canônico tipado (Zod) versionado; o prompt é uma projeção dele.
3. **Campanhas é um *capability* de Project**, não parte do núcleo de Project.
4. **Agentes pertencem à Account**, não ao Project. Project + Campaign *especializam*.
5. **Enforcement não é só prompt.** Regras verificáveis são checadas em código pós-geração.
6. **Nenhum domínio importa SDK de provider nem Prisma.** Sempre via ports.
7. **Tenant scoping é exigido na aplicação E garantido na infraestrutura.**
8. **Nada de estado em arquivo.** Uploads são `MediaAsset`; estado é linha de banco.
9. **Publicação é imutável.** O que está no ar só muda por nova publicação.
10. **A LLM propõe; o domínio valida e aplica.** Nunca o contrário.
11. **Abstração só quando há uso real** — no máximo uma implementação alternativa prevista.

---

## 2. Bounded Contexts

| Contexto | Responsabilidade | Domínio rico? |
|---|---|---|
| `identity` | Account, User, Membership, auth, RBAC, tenant context | médio |
| `projects` | Project, Profile, Brand Identity, Knowledge Sources, Capabilities | **sim** |
| `agents` | Agent, AgentVersion, configuração canônica do agente | **sim** |
| `campaigns` | Campaign, Strategy, CTA, publicação, `CampaignPublicDeployment` | **sim** |
| `conversations` | Runtime do agente: sessões, mensagens, estado, eventos | **sim** |
| `myaihub` | O OS: policy versionada, operações, propostas, `ConfigurationChange` | **sim** |
| `ai` | Providers, Context Compiler, Prompt Compiler, validadores, cache | shared kernel técnico |
| `usage` | AiCall, normalização de uso, pricing snapshot, CostEngine | fino |
| `metrics` | Ingestão de eventos + read models de dashboard | fino |

> **`platform` foi removido.** Storage, WebContentReader, EventBus/SSE, Audit, Logging e HTTP
> não têm regra de negócio própria — não são bounded context. Vivem em `shared/infrastructure`
> (implementações) com seus ports declarados em `shared/application/ports`.
> Exceção: `AuditLog` é **dado** com escopo de tenant, então é modelo Prisma normal escrito
> por um `AuditWriter` compartilhado; não vira módulo.

### Regras de dependência

```
identity  <-----------------+
   ^                        |
projects --(port)--> campaigns --(port)--> conversations
   ^                        ^                    ^
   +--------- agents -------+                    |
                 ^                               |
              myaihub --------------------------+
                 |
                 v
                ai ---> usage
                 |
                 v
              metrics
```

- **`projects` NUNCA conhece `campaigns`.** O inverso é permitido, e apenas através de uma
  **ACL / read-model publicado**: `ProjectContextPort.getProjectContext(projectId, tenant)`
  retorna um DTO estável (`ProjectContextSnapshot`). Se amanhã surgir `support` ou `blog`,
  consomem a mesma porta.
- Referências cross-context existem no banco como FK (integridade), mas **nenhum agregado
  navega para fora do próprio contexto** — só IDs + portas.
- `packages/shared` publica apenas **contratos** (Zod schemas canônicos, tipos de evento,
  enums, DTOs). Zero lógica de negócio, zero I/O.

---

## 3. Estrutura de diretórios

```
MyAIHub/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── main.ts                 # composition root
│   │       ├── container.ts            # DI manual (sem framework)
│   │       ├── http/                   # Express app, middlewares, error handler, SSE
│   │       ├── modules/
│   │       │   ├── identity/
│   │       │   ├── projects/
│   │       │   ├── agents/
│   │       │   ├── campaigns/
│   │       │   ├── conversations/
│   │       │   ├── myaihub/
│   │       │   ├── ai/
│   │       │   ├── usage/
│   │       │   └── metrics/
│   │       └── shared/
│   │           ├── domain/             # Entity, ValueObject, DomainError, Result
│   │           ├── application/        # UseCase, TenantContext, ports (Clock, IdGenerator,
│   │           │                       #   FileStorage, EventBus, WebContentReader, AuditWriter)
│   │           ├── infrastructure/     # Prisma client + tenantGuard, storage local, http client,
│   │           │                       #   in-memory event bus, logger, web content reader
│   │           └── presentation/       # controller base, zod validate, response envelope
│   └── web/
│       └── src/
│           ├── app/                    # router, providers, layouts
│           ├── design-system/          # tokens, primitives
│           ├── features/
│           │   ├── auth/ projects/ agents/ campaigns/ lab/ metrics/
│           │   └── hub/                # MyAIHub live panel, SSE client, event reducer
│           ├── public-chat/            # rota/bundle separado, sem chrome do painel
│           └── lib/                    # api client, query keys, hooks
├── packages/
│   └── shared/                         # contratos: canonical schemas, hub events, DTOs, enums
├── docker/
│   ├── api.Dockerfile
│   └── web.Dockerfile
├── docker-compose.yml                  # sobe tudo por padrão (mysql/adminer/api/web)
├── .env.example
└── docs/
```

Cada módulo do backend:

```
modules/<ctx>/
  domain/          # entidades, VOs, invariantes, eventos de domínio, ports
  application/     # use cases, DTOs, application services
  infrastructure/  # repositórios Prisma, adapters
  presentation/    # rotas Express + controllers + schemas Zod
```

Módulos finos (`usage`, `metrics`) não criam pastas vazias — só o que existe.

---

## 4. Modelo de dados

### 4.1 Padrão `VersionedAggregate`

```
<Aggregate>            id, accountId, ..., currentVersionId, lockVersion INT
<Aggregate>Version     id, <aggregate>Id, versionNumber, canonicalConfig JSON,
                       humanSummary JSON, canonicalSchemaVersion, source, reason,
                       previousVersionId, createdBy, createdAt   -- IMUTÁVEL
```

Mutação = **uma transação**:

1. `INSERT` nova version (imutável)
2. `UPDATE aggregate SET currentVersionId=?, lockVersion=lockVersion+1 WHERE id=? AND lockVersion=?`
   → 0 linhas afetadas = `ConcurrencyError` (versionamento otimista, §70)
3. `INSERT ConfigurationChange` (a intenção — ver 4.2)
4. `INSERT AuditLog`

Rollback = **nova versão** com `source=USER`, `reason="rollback to vN"`. Nunca deleta histórico.

### 4.2 `ConfigurationChange` — estado vs. intenção

`*Version` representa **ESTADO**. `ConfigurationChange` representa a **MUDANÇA/INTENÇÃO**
que produziu aquele estado. **Não duplica o canonical document.**

```
ConfigurationChange {
  id, accountId,
  entityType,            // AGENT | CAMPAIGN | PROJECT_PROFILE | BRAND_IDENTITY
  entityId,
  fromVersionId?,        // null na criação
  toVersionId,
  source,                // USER | MYAIHUB | SYSTEM
  actorUserId?,
  hubOperationId?,       // liga à operação do OS
  hubMessageId?,         // liga à FALA do usuário que originou tudo
  interpretedIntent,     // texto curto: "aumentar objetividade da comunicação"
  mutations JSON,        // lista de CanonicalMutation tipadas aplicadas (ver §7.3)
  rationale,             // por que o OS decidiu assim
  createdAt
}
```

Cadeia rastreável completa:

```
HubMessage("quero Philips mais objetivo")
   -> HubOperation(agent.configure)
   -> interpretedIntent
   -> mutations[] tipadas
   -> fromVersion v4 -> toVersion v5
   -> rationale
```

Isso responde exatamente **como** uma fala virou uma configuração. Sem duplicar o documento:
o documento está nas `*Version`; aqui está só o delta semântico e a proveniência.

### 4.3 `CampaignPublicDeployment` — publicação imutável

Publicar uma Campaign **congela um `DeploymentManifest`**. Alteração posterior em Agent,
Project ou Campaign **não muda** o que está no ar; exige nova publicação.

```
CampaignPublicDeployment {
  id, accountId, campaignId,
  publicId,                    // ULID não sequencial, único global
  deploymentNumber,            // 1, 2, 3...
  status,                      // ACTIVE | SUPERSEDED | PAUSED
  manifest JSON,               // DeploymentManifest — IMUTÁVEL
  manifestHash,                // sha256 do manifest canonicalizado
  publishedBy, publishedAt, supersededAt?
}
```

```ts
type DeploymentManifest = {
  manifestVersion: 2,
  campaignVersionId: string,
  agentId: string,
  agentVersionId: string,
  projectId: string,
  projectProfileVersionId: string,
  brandIdentityVersionId: string,
  knowledgeSnapshotId: string,          // conjunto congelado de fontes + revisões
  runtimeVersion: string,               // versão do Agent Runtime
  contextCompilerVersion: string,
  promptCompilerVersion: string,
  canonicalSchemaVersions: {            // por documento envolvido
    agent: number, campaign: number, projectProfile: number, brandIdentity: number
  },
  providerConfig: {                     // resolvido na publicação, não em runtime
    role: "agent.runtime",
    provider: "gemini" | "openai" | "anthropic" | "fake",
    model: string,
    generationParams: Record<string, unknown>
  },
  ruleChecks: Array<{ name: string; params: unknown }>   // determinísticos congelados
}
```

Regras:

**`manifestVersion: 2`** acrescentou `brandIdentityVersionId` e
`knowledgeSnapshotId`. Sem eles a publicação era imutável só pela metade: a página
trocava de cor porque alguém editou a marca noutra tela, e o agente respondia com
conteúdo reindexado hoje de manhã. "O que o público está vendo" inclui o que ele LÊ
e o que o agente SABE, não só o que o agente é.

Um deployment gravado na v1 continua legível: `readManifest` migra na LEITURA, e
marca e conhecimento entram nulos — que é a verdade sobre aquele deployment, porque
quando ele foi publicado não havia nenhum dos dois para congelar. O documento
gravado NUNCA é reescrito: atualizá-lo para "arrumar o formato" mudaria o hash e
desfaria a única coisa que ele existe para garantir.

- **Novas sessões** usam o deployment `ACTIVE` no momento em que nascem.
- **Sessões em andamento** permanecem ligadas ao `deploymentId` com que nasceram — republicar
  não muda conversa em curso. A sessão guarda `deploymentId` (não só as versões soltas).
- Republicar cria `deploymentNumber + 1`, marca o anterior `SUPERSEDED` e **preserva o `publicId`**
  (a URL do anúncio não pode quebrar). Histórico de deployments fica auditável.
- O Internal Lab pode executar **contra um manifest efêmero** (versões em rascunho, não publicadas)
  — marcado como `draft: true` no trace, nunca persistido como deployment.

### 4.4 `KnowledgeSnapshot`

Para o manifest ser realmente imutável, o conhecimento também precisa ser congelado:

```
ProjectKnowledgeSource   { id, projectId, accountId, kind, uri?, status, currentRevisionId }
KnowledgeRevision        { id, sourceId, contentHash, extractedContent, extractedAt }  -- IMUTÁVEL
KnowledgeSnapshot        { id, accountId, projectId, createdAt }
KnowledgeSnapshotItem    { snapshotId, sourceId, revisionId }
```

Reindexar uma fonte cria nova `KnowledgeRevision`; deployments existentes seguem apontando
para o snapshot antigo.

### 4.5 Entidades

```mermaid
erDiagram
  Account ||--o{ AccountMembership : has
  User ||--o{ AccountMembership : has
  Account ||--o{ Project : owns
  Account ||--o{ Agent : owns

  Project ||--o{ ProjectProfileVersion : versions
  Project ||--o{ ProjectBrandIdentityVersion : versions
  Project ||--o{ ProjectKnowledgeSource : has
  ProjectKnowledgeSource ||--o{ KnowledgeRevision : revises
  Project ||--o{ KnowledgeSnapshot : freezes
  Project ||--o{ ProjectCapability : enables

  Agent ||--o{ AgentVersion : versions

  Project ||--o{ Campaign : contains
  Agent ||--o{ Campaign : bound_to
  Campaign ||--o{ CampaignVersion : versions
  Campaign ||--o{ CampaignInputSource : briefed_by
  Campaign ||--o{ CampaignPublicDeployment : publishes

  CampaignPublicDeployment ||--o{ ConversationSession : serves
  ConversationSession ||--o{ ConversationMessage : has
  ConversationSession ||--|| ConversationState : has
  ConversationSession ||--o{ SessionEvent : emits
  ConversationSession ||--o{ ExecutionTrace : records

  Account ||--o{ HubConversation : has
  HubConversation ||--o{ HubMessage : has
  HubConversation ||--o{ HubOperation : runs
  HubOperation ||--o{ HubOperationEvent : streams
  HubOperation ||--o{ ConfigurationProposal : proposes
  HubOperation ||--o{ ConfigurationChange : produces

  HubPolicy ||--o{ HubPolicyVersion : versions

  AiModelPricing ||--o{ AiCall : prices
  Account ||--o{ AuditLog : scopes
  Account ||--o{ MediaAsset : scopes
```

Notas de modelagem:

- **`accountId` em toda tabela raiz**, inclusive nas filhas de alto volume (`ConversationMessage`,
  `SessionEvent`, `AiCall`) — desnormalização deliberada para scoping e índice.
- **JSON do MySQL** guarda estado canônico versionado. Tudo que é **consultado/filtrado/agregado**
  vira coluna real (status, publicId, eventType, occurredAt, tokens, cost). Nunca query dentro de JSON.
- `AiModelPricing` versionada por `(provider, model, effectiveFrom)`. `AiCall` grava
  `pricingVersionId` **e** `pricingSnapshot JSON` — histórico nunca é recalculado (§38).

### 4.6 Índices iniciais

`(accountId, createdAt)`, `(accountId, projectId)`, `(projectId, status)`,
`(campaignId, createdAt)`, `(sessionId, seq)`, `(sessionId, eventType)`,
`publicId UNIQUE`, `(campaignId, status)`, `(provider, model, effectiveFrom)`.

---

## 5. Configuração Canônica

### 5.1 Identidade dos itens

Cada item canônico tem **três identificadores com papéis distintos**:

```ts
type CanonicalItem<TConfig> = {
  id: string,              // ULID — IDENTIDADE TÉCNICA PRIMÁRIA, estável para sempre
  code: string,            // "CM01" — rótulo de UX/rastreabilidade, pode ser renumerado
  semanticKey: string,     // "communication.objectivity" — chave de deduplicação semântica
  label: string,           // "Objetividade"
  statement: string,       // texto humano exibido ao usuário
  config: TConfig,         // campos estruturados da faceta
  enforcement: "SOFT" | "HARD" | "DETERMINISTIC",
  check?: { name: string; params: unknown },   // só se DETERMINISTIC
  source: "USER" | "MYAIHUB" | "SYSTEM",
  originHubMessageId?: string,
  createdAt: string,
  updatedAt: string,
}
```

- `id` é o que o domínio usa para localizar e mutar. Nunca muda.
- `semanticKey` é o que impede a duplicação de "seja objetivo" / "não explique demais":
  **`semanticKey` é único dentro da faceta** — invariante validada em código, não confiada ao LLM.
  Um upsert com `semanticKey` existente **funde** no item existente.
- `code` é derivado (`prefixo da faceta + ordinal`) e serve só para exibição.

### 5.2 Documento canônico

```ts
CanonicalAgentConfig = {
  canonicalSchemaVersion: 1,
  identity:      { role, archetype, ... },
  objective:     { primary, secondary[] },
  personality:   CanonicalItem<PersonalityConfig>[],     // PS
  communication: CanonicalItem<CommunicationConfig>[],   // CM
  skills:        CanonicalItem<SkillConfig>[],           // SK
  behaviors:     CanonicalItem<BehaviorConfig>[],        // BH
  strategies:    CanonicalItem<StrategyConfig>[],        // ST
  hardRules:     CanonicalItem<RuleConfig>[],            // HR
  limits:        CanonicalItem<RuleConfig>[],            // LM
  capabilities:  ToolRef[],
  knowledge:     KnowledgeRef[],
}
```

`CanonicalCampaignStrategy` segue o mesmo padrão com
`goal / audience / discoveryDimensions / strategy / conversionBehavior / knowledgeScope / rules`.

```ts
CanonicalProjectProfile = {
  canonicalSchemaVersion: 2,
  name, type, summary,
  business:           { model, stage },
  audiences:          CanonicalItem[],   // AU
  offerings:          CanonicalItem[],   // OF
  valuePropositions:  CanonicalItem[],   // VP
  differentiators:    CanonicalItem[],   // DF
  market:             CanonicalItem[],   // MK  — v2
  businessRules:      CanonicalItem[],   // BR  — v2
}
```

`market` e `businessRules` entraram na v2 porque o usuário chega ao OS com
exatamente essas duas coisas — análise de mercado e, principalmente, regra de
negócio — e elas não tinham onde morar. O que não tem seção vira `summary`
inchado: fica na tela, não é editável nem removível, e não chega ao agente como
regra.

**`businessRules` é a única faceta do perfil com efeito de RUNTIME.** Um item
`HARD` ali entra no bloco `REGRAS INEGOCIÁVEIS` do prompt de todo agente que
atua no projeto, acima da personalidade, da estratégia e do que a campanha
disser. As demais facetas informam; esta obriga. É a mesma regra do
`enforcement` do agente, um nível acima — e com o mesmo custo se for ignorada.

### 5.3 Migração de canonical schemas

Mecanismo explícito desde o início:

```
shared/canonical/
  agent/v1.ts        # Zod schema
  agent/v2.ts
  agent/migrations.ts  # { from: 1, to: 2, migrate(doc): doc }
  agent/index.ts       # parse(doc) -> migra em cadeia até LATEST, valida, retorna tipado
```

- Versões antigas **continuam interpretáveis**: `parse()` aplica migrações em cadeia (`v1→v2→v3`)
  na leitura. O documento persistido **não é reescrito** — a versão gravada é a que foi criada.
- Reescrita só acontece quando uma nova `*Version` é criada naturalmente (aí grava no `LATEST`).
- Existe teste obrigatório: para cada versão histórica, um fixture que precisa migrar e validar.
- `DeploymentManifest.canonicalSchemaVersions` registra a versão de cada documento no ato da
  publicação — o runtime sabe exatamente o que estava valendo.

### 5.4 Por que isso não é um EAV genérico

Schema **fechado e versionado**, facetas enumeradas em código, `semanticKey` de um vocabulário
controlado por faceta, validação Zod na borda. Não existe "chave arbitrária → valor arbitrário".

---

## 6. Enforcement (§8)

Dois validadores **separados**, com custos e naturezas diferentes:

### 6.1 `DeterministicRuleCheckRegistry`

Catálogo **fechado** de checkers implementados em código, executados sobre a resposta.
Custo zero, resultado binário e explicável.

```
max_questions_per_message   max_message_length      must_not_mention
must_offer_cta_when         forbid_urls_outside     require_language
```

O canônico só pode referenciar um checker registrado, com params validados por Zod do próprio
checker. Isso impede que o banco vire "regras em linguagem natural executáveis".

### 6.2 `SemanticAdherenceValidator`

Para hard rules que **não** são mecanicamente verificáveis
(*"nunca prometa prazo de pagamento"*, *"não confirme disponibilidade de agenda"*).

- Só roda quando existe pelo menos uma `hardRules[]` marcada `HARD` **e** classificada como
  semântica (i.e., sem `check`).
- Usa um modelo barato (`ModelRouter.role = "validation.fast"`), com output estruturado
  `{ adherent: boolean, violations: [{ itemId, evidence }] }`.
- É **opt-out por campanha** (custo): `campaign.settings.semanticValidation = on|sampled|off`.
  Default `sampled` em produção, `on` no Lab.

### 6.3 Pipeline

```
LLM response
  -> DeterministicRuleCheckRegistry        (sempre; barato)
  -> SemanticAdherenceValidator            (quando aplicável; amostrado em produção)
  -> aprovada -> entrega

violação:
  -> registra RuleViolation + SessionEvent(RULE_VIOLATION, source=OBSERVED)
  -> no máximo 1 regeneração corretiva  (hard cap, sem loop de custo)
  -> se persistir: fallback seguro + violation marcada como CRITICAL
```

Violação de uma parametrização explicitamente `HARD` é **falha crítica do MyAIHub**,
medida e exibida como tal. Nunca "o usuário precisa melhorar o prompt".

---

## 7. Fluxo do MyAIHub OS

### 7.1 Operações tipadas, não chat livre

```ts
type MyAIHubOperation<TIn, TOut> = {
  name: string,                                  // "agent.configure"
  scope: "ROOT" | "PROJECT" | "AGENT" | "CAMPAIGN",
  inputSchema: ZodSchema<TIn>,
  outputSchema: ZodSchema<TOut>,                 // structured output do provider
  canonicalSchemaVersion: number,                // contra qual schema opera
  allowedMutations: CanonicalMutationKind[],     // ESCOPO PERMITIDO DE MUTAÇÃO
  policySections: string[],
  contextRequirements: ContextRequirement[],
  applyMode: "USER_DIRECTED" | "AI_SUGGESTED",
  modelRole: string,                             // "hub.reasoning" | "hub.fast"
  tokenBudget: number,
}
```

### 7.2 A LLM propõe; o domínio aplica

**Não existe JSON Patch arbitrário.** O output estruturado da operação é uma lista de
**mutações de domínio tipadas**, e cada tipo tem um handler em código que valida invariantes.

```ts
type CanonicalMutation =
  | { kind: "UPSERT_COMMUNICATION_TRAIT"; semanticKey: string; label; statement; config; enforcement }
  | { kind: "UPSERT_PERSONALITY_TRAIT";   semanticKey: string; ... }
  | { kind: "UPSERT_SKILL";               semanticKey: string; ... }
  | { kind: "UPSERT_BEHAVIOR" | "UPSERT_STRATEGY" | "UPSERT_HARD_RULE" | "UPSERT_LIMIT"; ... }
  | { kind: "REMOVE_ITEM";                facet: Facet; itemId: string; reason: string }
  | { kind: "SET_OBJECTIVE";              primary: string; secondary?: string[] }
  | { kind: "SET_IDENTITY";               role: string; archetype?: string }
  | { kind: "ATTACH_DETERMINISTIC_CHECK"; itemId: string; check: { name; params } }
```

Regras aplicadas pelo domínio (`CanonicalMutationApplier`), não pela LLM:

- A mutação precisa estar em `operation.allowedMutations` — caso contrário é **rejeitada**
  e registrada como `validation.warning`. Uma operação de comunicação não pode mexer em `limits`.
- `semanticKey` precisa pertencer ao vocabulário da faceta.
- `UPSERT` com `semanticKey` existente **funde** no item (preserva `id`); não cria duplicata.
- `ATTACH_DETERMINISTIC_CHECK` só aceita checker do `DeterministicRuleCheckRegistry`, com params
  validados pelo Zod do checker.
- `REMOVE_ITEM` exige `reason` e, se o item for `source: USER`, exige confirmação explícita.
- O documento resultante é revalidado inteiro pelo Zod canônico antes de virar `*Version`.

### 7.3 Pipeline

```
Intenção do usuário (linguagem natural)
   |
   v  Operation Router          (heurístico por rota/contexto; LLM barato só quando ambíguo)
   v  Context Compiler          (policy sections + Project + Agent + Campaign + conversa)
   v  Prompt Compiler -> Provider Adapter (structured output + stream)
   v  Output: { mutations: CanonicalMutation[], interpretedIntent, rationale,
   |            humanSummary, conflicts[], gaps[] }
   v  CanonicalMutationApplier  (escopo, semanticKey, invariantes, merge)
   v  Zod: documento canônico completo
   |
   +-- USER_DIRECTED -> transação: nova *Version + ConfigurationChange + AuditLog
   +-- AI_SUGGESTED  -> ConfigurationProposal pendente -> confirmação do usuário (§65)
   |
   v  HubEvents via SSE -> UI viva
```

### 7.4 Master Policy

`HubPolicy` + `HubPolicyVersion` no banco (nunca `.md` como fonte de verdade). Seccionada;
o Context Compiler injeta só as seções declaradas pela Operation.

**Todo `HubOperation` e todo `AiCall` registram `policyVersionId` + `policySections[]` usadas.**

A policy textual orienta *julgamento* (interpretar intenção, expandir implicações, propor melhor
abordagem). Ela **não** é o mecanismo de garantia: estrutura de output, schema, escopo de mutação,
tenant scoping e segurança são garantidos por código. Policy que "pede" algo estruturalmente
crítico é redundância, não controle.

---

## 8. Fluxo do Agent Runtime (§57)

```
POST /public/chat/:publicId/messages   (ou /lab/sessions/:id/messages)
   |
   v Resolve Session -> deploymentId (fixado no nascimento da sessão)
   v Load DeploymentManifest  -> todas as versões, compilers, provider/model, ruleChecks
   v Load ConversationState (facts, signals, strategy, progress)
   v Retrieve Relevant Knowledge (dentro do KnowledgeSnapshot do manifest)
   v Context Compiler -> ContextPackage
   v Prompt Compiler -> Provider Adapter (stream + cache markers)
   v DeterministicRuleCheck -> SemanticAdherenceValidator -> (1 retry corretivo no máx.)
   v Persist: ConversationMessage, patch de ConversationState, AiCall (usage + cost),
   |          ExecutionTrace
   v Emit SessionEvents -> metrics
```

**A sessão está ligada ao deployment, não a versões soltas.** É o que garante que uma
republicação não altere conversa em andamento.

**ConversationState** é JSON canônico com merge controlado pelo use case
(`facts`, `signals`, `strategy`, `progress`) — nunca sobrescrito por inteiro pelo LLM;
o modelo propõe um patch estruturado que é validado antes de aplicar.

### 8.1 `ExecutionTrace` — reprodutibilidade

Cada execução persiste (no Lab sempre; em produção amostrado + sempre em caso de violação/erro):

```ts
ExecutionTrace {
  id, accountId, sessionId?, hubOperationId?, turnIndex,
  deploymentId?, deploymentManifestHash?,     // null no Lab com manifest efêmero
  effectiveManifest JSON,                     // manifest efetivo (útil p/ Lab draft)
  provider, model, generationParams JSON,     // temperature, topP, thinking/reasoning budget...
  runtimeVersion, contextCompilerVersion, promptCompilerVersion,
  policyVersionId?, policySections JSON,
  canonicalSchemaVersions JSON,
  knowledgeSnapshotId?, knowledgeRefs JSON,   // o que efetivamente entrou no contexto
  contextBlocks JSON,                         // ids, kinds, hashes, tokens, o que foi cortado
  compiledRequest JSON,                       // request exato enviado ao provider
  aiCallId,
  violations JSON,
  createdAt
}
```

> **Definição de reprodutível:** conseguir **reconstruir exatamente o contexto, a configuração
> e o request enviados ao provider**. Não se promete resposta byte-idêntica da LLM.

Retenção: traces de produção têm TTL configurável; traces do Lab e de violações são retidos.

---

## 9. Context Compiler & Cache

`ContextPackage` = lista ordenada de blocos:

```ts
{ id, kind: "POLICY" | "STABLE" | "DYNAMIC" | "KNOWLEDGE" | "UNTRUSTED",
  trust: "TRUSTED" | "UNTRUSTED",
  cacheable: boolean, tokensEstimate: number, contentHash: string,
  sourceVersionId?: string, content: string }
```

- `STABLE` (Agent Core, Project Profile, Campaign Strategy) → prefixo cacheável, ordem determinística.
- `DYNAMIC` (Session State, últimos turnos) → sufixo.
- **Orçamento de tokens** por operação; corta por prioridade e **registra no trace o que cortou**.
- Cache é responsabilidade **do adapter** (Anthropic `cache_control`, equivalentes OpenAI/Gemini).
  O domínio só declara `cacheable`.

### 9.1 Segregação de conteúdo untrusted

Conteúdo de sites, páginas, documentos externos e input do público final é **sempre `UNTRUSTED`**.

Garantias estruturais, aplicadas pelo Prompt Compiler:

1. Blocos `UNTRUSTED` **nunca** ocupam a região de instruções (system/developer). Vão para uma
   região de dados separada, delimitada e rotulada.
2. Delimitadores gerados com nonce por request; o conteúdo é escapado para não fechar o delimitador.
3. Precedidos de instrução fixa: *este bloco é DADO a ser analisado, não instrução a ser obedecida*.
4. O Prompt Compiler **lança** se um bloco `UNTRUSTED` for roteado para região trusted — invariante
   de código com teste, não convenção.
5. Nenhuma tool/ação de escrita é acionável a partir de conteúdo untrusted no MVP.

SSRF protection no `WebContentReader` conforme §16.

---

## 10. Providers, Usage e Custo

```ts
interface LlmProvider {
  readonly name: string
  generate(req: LlmRequest): Promise<LlmResult>
  stream(req: LlmRequest): AsyncIterable<LlmChunk>
  generateStructured<T>(req: LlmRequest, schema: ZodSchema<T>): Promise<LlmResult<T>>
  capabilities(): ProviderCapabilities   // caching, structuredOutput, reasoning, vision, streaming
}
```

Implementações: **`FakeProvider`**, `GeminiProvider`, `OpenAiProvider`, `AnthropicProvider`.
Nenhum SDK fora de `modules/ai/infrastructure/providers`.

- **`FakeProvider` é permanente**, não um andaime. Todo unit/integration/E2E roda contra ele —
  determinístico, sem custo, com respostas roteirizáveis por cenário. Nenhum teste automatizado
  consome API paga, mesmo com todas as chaves configuradas.
- **`ModelRouter`** mapeia *role* → provider/model, configurável por ambiente:

  | role | default dev |
  |---|---|
  | `hub.reasoning` | `gemini / gemini-flash-lite` |
  | `hub.fast` | `gemini / gemini-flash-lite` |
  | `agent.runtime` | `gemini / gemini-flash-lite` |
  | `validation.fast` | `gemini / gemini-flash-lite` |
  | `analysis.vision` | `gemini / gemini-flash-lite` |

  Cada role é sobrescritível por env (`MODEL_ROLE_HUB_REASONING=anthropic:claude-...`).
  Providers sem chave são registrados como **indisponíveis** e falham com erro claro
  (`PROVIDER_NOT_CONFIGURED`) — a ausência de chave nunca quebra o boot.
- `generateStructured` normaliza as diferenças (tool-call / json_schema / json mode + reparo),
  com validação final por Zod.

`UsageNormalizer` por provider → forma única
(`inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, toolCalls, totalTokens, latencyMs`).

`CostEngine` resolve o `AiModelPricing` vigente no instante da chamada e persiste
`pricingVersionId + pricingSnapshot + calculatedCost + currency` em `AiCall`.

---

## 11. Streaming & Live UI Event Protocol (§32)

Transporte: **SSE**. Contrato em `packages/shared`:

```ts
type HubEvent =
  | { type: "message.delta";           seq: number; operationId: string; text: string }
  | { type: "operation.started";       seq: number; operation: string; label: string }
  | { type: "operation.progress";      seq: number; operation: string; status: string; label: string }
  | { type: "operation.completed";     seq: number; operation: string; status: string }
  | { type: "workspace.patch";         seq: number; target: string; patch: unknown }
  | { type: "configuration.proposed";  seq: number; proposalId: string; summary: string }
  | { type: "configuration.applied";   seq: number; changeId: string; summary: string }
  | { type: "validation.warning";      seq: number; code: string; message: string }
```

- `seq` monotônico; todo evento persistido em `HubOperationEvent` → reconexão com `Last-Event-ID`
  faz replay (operação longa sobrevive a refresh).
- `EventBus` é uma porta; implementação MVP in-memory (instância única). Redis depois, sem tocar
  nos use cases.
- Frontend: `useHubStream` → reducer tipado → dois consumidores simultâneos: chat (texto em
  streaming) e workspace (checklist/patches). É isso que produz o "painel vivo".

**Quick actions e saudação NÃO chamam LLM** — `ContextualActionRegistry` resolve por rota/estado (§31).

---

## 12. Multi-tenancy (§47)

Isolamento é exigido **na aplicação** e garantido **na infraestrutura**. As duas camadas são
obrigatórias; a segunda é defense-in-depth, não substituto da primeira.

1. **Middleware** monta `TenantContext { accountId, userId, role, elevated?, reason? }`.
2. **Use cases e repositórios tenant-scoped recebem `TenantContext` explicitamente na assinatura.**
   Não existe método de repositório tenant-scoped sem escopo. Isso é a regra primária.
3. **Prisma Client Extension `tenantGuard`** — fail-closed: intercepta operações em modelos
   tenant-scoped e **lança** se o `where`/`data` não contiver `accountId` (ou se o contexto não
   estiver marcado como elevado). Nunca filtra silenciosamente.

Superfícies de risco tratadas explicitamente:

| Superfície | Tratamento |
|---|---|
| `$queryRaw` / `$executeRaw` | **Proibido por lint rule.** Exceções exigem `// tenant-reviewed:` com justificativa e teste de isolamento dedicado |
| Seeds e scripts | Rodam com `SystemTenantContext` explícito e auditável; nunca com o client cru |
| Jobs futuros | Só podem ser criados a partir de um `TenantContext` serializado no payload |
| Public Chat | Não tem usuário, mas **tem tenant**: `accountId` é derivado do `publicId` → deployment → campaign, no servidor. Nunca do request |
| Operações administrativas | `elevated` só por `ElevateScopeUseCase(reason)` → `AuditLog(CROSS_TENANT_ACCESS)`. Nunca implícito |

Admin possui sua própria Account e usa o produto normalmente.
Testes de isolamento fazem parte do critério de pronto de cada módulo (Flows 7 e 8 do §72).

---

## 13. Extensibilidade para módulos futuros (§40, §79)

```
ProjectCapability { id, accountId, projectId, type: "CAMPAIGNS", enabled, settings JSON, enabledAt }
```

- Registro/ativação apenas. **Zero lógica genérica.**
- `CapabilityRegistry` (código) mapeia `type` → `{ label, icon, routes, sidebarItems, hubOperations }`.
- Sidebar do Project e Operations disponíveis no Hub são **derivadas** das capabilities ativas.
- Adicionar `SUPPORT` no futuro = novo bounded context + entrada no registry. **Zero alteração em
  `projects`, `agents` ou no OS.**

---

## 14. Docker / ambiente local

`docker compose up -d` sobe os quatro serviços por padrão: `mysql:8.4` (volume
nomeado, healthcheck) + `adminer` + `api`/`web` em containers de dev (bind
mount + hot reload), com `depends_on: condition: service_healthy` em cadeia —
`web` só sobe depois de `api` responder saudável, `api` só depois de `mysql`.

Para rodar `api`/`web` no HOST em vez de container (melhor DX e HMR no
Windows): `docker compose up -d mysql adminer` + `npm run dev`.

Dockerfiles multi-stage (`docker/api.Dockerfile`, `docker/web.Dockerfile`) servem dev e produção.
Config exclusivamente por env. Segredos nunca no `.env.example` nem no repositório.

```bash
cp .env.example .env      # preencher GEMINI_API_KEY
docker compose up -d
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

---

## 15. Plano de implementação

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **0** ✅ | Monorepo (npm workspaces), TS strict, ESLint/Prettier, Vitest, compose, CI | `lint/typecheck/test/build` verdes |
| **1** ✅ | Prisma + MySQL, `identity`, auth (access + refresh httpOnly), RBAC, tenantGuard, seed | Flows 7 e 8 passam |
| **2** ✅ | Design system + App Shell (sidebar empilhada, temas, painel vivo vazio) | Navegação e temas completos, a11y básica |
| **3** ✅ | `ai` core: `FakeProvider` + Gemini, ContextCompiler, PromptCompiler, SSE, usage, cost | Chamada ponta a ponta com `AiCall` + `ExecutionTrace` |
| **4** ✅ | `myaihub`: policy versionada, operations, mutações tipadas, `ConfigurationChange`, live events | Criar Project via OS — Flow 1 |
| **5** ✅ | `projects`: profile (v2: mercado + regras de negócio), workspace por seção, brand identity, knowledge + snapshots, capabilities, WebContentReader | Flow 1 completo |
| **6** ✅ | `agents`: canônico, versionamento, migração de schema, fluxo de configuração pelo OS | Flow 2 |
| **7** ✅ | `campaigns`: binding, estratégia, CTA, versionamento, **publicação com manifest** | Flow 3 |
| **8** ✅ | Internal Lab pelo agente, pelo PROJETO e pela campanha, com tokens, custo e violações; `conversations` persistindo os dois canais | Flow 4 |
| **9** ✅ | Public Chat: serve a publicação congelada, com a MARCA e o CONHECIMENTO congelados, mobile-first, rate limit próprio | Flow 5 |
| **10** ✅ | `metrics`: `SessionEvent` + dashboard na conta, no projeto e na campanha | Flow 6 |
| **11** ✅ | Hardening: E2E Playwright, validação semântica de aderência, guarda de escrita tenant-scoped | Todos os 8 flows verdes |

`ai` core (Fase 3) vem **antes** de Projects porque Projects é criado *através* do OS,
que depende dela. Evita construir duas vezes.

**Estado real (2026-09-03).** Todas as fases concluídas e verificadas contra o Gemini
real, pelo caminho HTTP do browser. O que a Fase 5 devia e agora entrega: identidade
de marca versionada (`ProjectBrandIdentityVersion`), fontes de conhecimento com
revisões imutáveis e `KnowledgeSnapshot` congelado na publicação. O `manifestVersion`
subiu para **2** com `brandIdentityVersionId` e `knowledgeSnapshotId`; um deployment
gravado na v1 continua legível — `readManifest` migra na LEITURA, e o documento
gravado nunca é reescrito, porque reescrevê-lo desfaria a única coisa que ele existe
para garantir.

**A conversa deixou de ser do cliente (Fase 8).** O histórico vinha do navegador nos
dois canais, e isso significava três coisas: recarregar a página apagava o atendimento
no meio, o servidor acreditava no cliente sobre o que ele mesmo tinha respondido, e a
Fase 10 não tinha o que medir. Agora o cliente manda um `sessionId` e o histórico é
lido do banco. A sessão nasce ligada ao `deploymentId` e morre com ele — republicar
não troca o agente embaixo de quem está falando.

**E o cliente precisa achar o caminho de volta.** Persistir no servidor resolve
metade: o `sessionId` vivia na memória do React e um F5 perdia o ponteiro, com
o atendimento inteiro no banco. Ele agora fica em `sessionStorage` e o
transcrito volta por `GET /api/public/:publicId/sessions/:sessionId` (público,
validado contra o endereço) e `GET /api/conversations/:id` (autenticado).

**A sessão não tem estado de aberta/encerrada.** Encerrar exige um gatilho —
job de expiração por inatividade ou ação explícita — e nenhum dos dois existe.
Uma coluna que nunca sai de OPEN mente sobre o que o sistema sabe; ela entra
junto do gatilho.

**O Lab persiste, em canal próprio.** `channel: LAB` fica FORA de toda métrica: são
dezenas de turnos de teste por dia, e misturá-los faria o número de conversas subir
sempre que alguém estivesse trabalhando. A razão original de o Lab ser efêmero
("experimento que suja o relatório") continua valendo — quem a resolve agora é o
canal, não a ausência de persistência.
**O projeto virou o lugar onde o negócio é administrado.** O perfil ganhou
`market` e `businessRules` (canônico v2), a seção `information_routing` da Master
Policy, e `project.organize_workspace` — a operação que analisa o que já existe
sem informação nova. O `ProjectProfileTarget` passou a publicar um bloco
`project.workspace` com as campanhas e os agentes do projeto: sem isso o OS
respondia "o que falta aqui?" sem saber o que já está sendo cobrado do perfil,
nem a quem uma regra nova passa a valer.

E o perfil INTEIRO passa ao agente. Chegava `profile.summary` — uma frase: tudo
o que o usuário cadastrava no projeto morria na tela do projeto, e o agente
representava um negócio do qual conhecia uma linha. Medido pelo HTTP real, com
as três regras que o usuário declarou: o agente recusou o material fora de
escopo e recusou dar prazo, citando a política — as duas regras testadas.

---

## 16. Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| 1 | LLM propondo mutação fora de escopo | `allowedMutations` por operação; mutação fora do escopo é rejeitada e registrada, não aplicada |
| 2 | Duplicação semântica de configuração | `semanticKey` único por faceta, vocabulário controlado, upsert funde em vez de criar |
| 3 | Custo de LLM explodindo | Orçamento de tokens por operação; policy seccionada; quick actions sem LLM; modelo barato para roteamento e validação semântica; validação semântica amostrada em produção; cache de prefixo estável; **hard cap de 1 retry** |
| 4 | Canônico virar EAV disfarçado | Schema Zod fechado, facetas enumeradas, `semanticKey` de vocabulário controlado, migrações versionadas |
| 5 | SSE não escala sem pub/sub | Aceito no MVP (instância única). `EventBus` é porta; eventos persistidos permitem replay. Sticky session documentada |
| 6 | Prompt injection | Blocos `UNTRUSTED` em região separada, delimitador com nonce, escape, invariante de código no Prompt Compiler (§9.1) |
| 7 | SSRF | Allowlist de esquema; bloqueio de IP privado/loopback/link-local **após** resolução DNS; sem redirect para rede privada; timeout; limite de tamanho; metadata endpoints negados |
| 8 | JSON no MySQL dificulta consulta | Tudo que se consulta é coluna; JSON só para estado canônico lido por ID |
| 9 | Structured output difere entre providers | `generateStructured` normaliza; `capabilities()` explícito; validação final por Zod |
| 10 | Publicação mudando silenciosamente | `DeploymentManifest` imutável + hash; sessão ligada ao deployment (§4.3) |
| 11 | Vazamento de tenant | Contexto explícito na aplicação + guard fail-closed no Prisma + lint contra raw + tabela de superfícies (§12) |
| 12 | Schema canônico evoluir e quebrar dados antigos | Migrações em cadeia na leitura + fixtures de regressão por versão (§5.3) |
| 13 | Testes consumindo API paga | `FakeProvider` permanente e default em `NODE_ENV=test` |

### 16.1 O que deliberadamente **não** fazemos agora

- RAG vetorial (port `KnowledgeRetriever` existe; MVP é escopo + keyword sobre `KnowledgeSnapshot`).
- Redis, WebSocket, filas.
- Domínio genérico de capabilities com lógica plugável — só registro.
- Billing, wallet, créditos (mas `AiCall` já custeia desde a primeira chamada).
- Editor visual de prompt (contraria o §83).

---

## 17. Verificação de consistência da v0.2

Mudanças da v0.1 e suas consequências, conferidas:

| Mudança | Consequência propagada |
|---|---|
| `DeploymentManifest` | `ConversationSession` passa a referenciar `deploymentId` (não versões soltas); `CampaignPublicDeployment` vira 1:N com `deploymentNumber`, `publicId` preservado entre republicações; Lab usa manifest efêmero `draft: true` |
| Knowledge congelado | Novas entidades `KnowledgeRevision`, `KnowledgeSnapshot`, `KnowledgeSnapshotItem` (§4.4); Fase 5 passa a incluí-las |
| `ConfigurationChange` | Substitui `ConfigurationRevision`; não duplica canonical doc; ganha `hubMessageId` + `interpretedIntent` + `mutations[]`; passo 3 da transação do §4.1 atualizado |
| Mutações tipadas | `MyAIHubOperation` ganha `inputSchema`, `allowedMutations`, `canonicalSchemaVersion`, `tokenBudget`; surge `CanonicalMutationApplier`; o output do LLM deixa de ser "patch" e passa a ser `CanonicalMutation[]` |
| Validadores separados | `RuleCheckRegistry` → `DeterministicRuleCheckRegistry` + `SemanticAdherenceValidator`; `ModelRouter` ganha role `validation.fast`; campanha ganha `semanticValidation` em settings; manifest congela `ruleChecks` |
| Identidade tripla | `CanonicalItem` ganha `id`/`code`/`semanticKey`; `semanticKey` único por faceta vira invariante; upsert por `semanticKey` substitui "merge heurístico"; `schemaVersion` renomeado para `canonicalSchemaVersion` em todo o documento |
| Migração de schemas | Nova §5.3; `DeploymentManifest.canonicalSchemaVersions`; fixtures de regressão obrigatórios |
| Tenant endurecido | §12 reescrita; tenant explícito na aplicação vira regra primária; tabela de superfícies (`$queryRaw`, seeds, jobs, public chat, admin); public chat deriva `accountId` do `publicId` no servidor |
| Policy rastreada | `HubOperation` e `AiCall` gravam `policyVersionId` + `policySections[]`; `ExecutionTrace` idem |
| Untrusted segregado | `ContextBlock` ganha `trust`; §9.1 com nonce, escape e invariante de código no Prompt Compiler |
| `FakeProvider` | Vira permanente e default em teste; providers sem chave = `PROVIDER_NOT_CONFIGURED`, boot nunca quebra; `ModelRouter` por role sobrescritível por env |
| `platform` removido | Storage, WebContentReader, EventBus, Logger, HTTP client migram para `shared/application/ports` + `shared/infrastructure`; §2 e §3 atualizadas; `AuditLog` continua modelo Prisma com `AuditWriter` compartilhado |

**Inconsistências residuais resolvidas nesta revisão:**

- `ConversationSession` não pode mais fixar versões individualmente — seria uma segunda fonte de
  verdade concorrendo com o manifest. Fixa `deploymentId`; as versões são lidas do manifest.
- `PromptTrace` da v0.1 foi absorvido por `ExecutionTrace`, que é mais amplo (contexto + request +
  manifest + policy + violações). Não existem duas entidades de trace.
- O termo "patch" foi eliminado do fluxo do OS para não sugerir JSON Patch livre; o vocabulário
  correto é **mutação de domínio tipada**. "Patch" permanece válido apenas para
  `ConversationState` e `workspace.patch` (UI), que são contextos distintos.
- `schemaVersion` (ambíguo com `manifestVersion` e versão de agregado) foi renomeado para
  `canonicalSchemaVersion` em todas as ocorrências.

---

## 18. Critério de sucesso

O fluxo completo do §82, ponta a ponta, com:
banco como fonte de verdade · publicação imutável · versionamento com rollback ·
isolamento de tenant testado · custo e uso rastreados por chamada · execução reconstituível ·
métricas apenas objetivamente rastreáveis · e o próximo módulo podendo ser **adicionado**,
não enxertado.

---

## 19. Playbook de ofício

A `craft` da Master Policy manda o OS **derivar** o ofício em vez de perguntá-lo. A fonte desse
ofício, porém, era só o que o modelo por acaso soubesse do papel — raso, e diferente a cada
chamada. O Playbook é essa fonte, escrita uma vez e versionada.

**Modelagem.** `Playbook` + `PlaybookVersion`, espelhando `HubPolicy`/`HubPolicyVersion`:
`UNSCOPED` (conhecimento da plataforma, igual para toda conta), versionado, semeado aditivamente
no boot. O admin — `UserRole.ADMIN`, papel de plataforma, distinto de `MembershipRole` — edita
criando versão nova; a semente nunca sobrescreve curadoria. A única exceção: versão gravada que
não valida contra o schema atual é **ressemeada**, porque o leitor a descarta e o OS voltaria a
projetar sem ofício em silêncio.

`PlaybookMiss` (`TENANT_SCOPED`) registra o papel que não casou com playbook nenhum. É a pauta do
admin, não telemetria: sem ela a lacuna é invisível.

**Distinto de `KnowledgeSource` (Fase 5).** Playbook é conhecimento de **plataforma**, usado em
tempo de **projeto**, sobre o OFÍCIO. Knowledge source é conhecimento da **conta**, usado em
**runtime**, sobre o NEGÓCIO dela. Escopos, ciclos de vida e leitores diferentes — não se
sobrepõem e não devem ser fundidos.

**Não é template por profissão.** O playbook entra como bloco de contexto (`playbook.craft`,
prioridade 92); quem escreve os itens canônicos continua sendo o modelo, pelas mesmas Operations
tipadas e pelas mesmas `CanonicalMutation`. Nenhum `if (role === …)` produz configuração.

**Classificação sem chamada extra.** O turno de briefing que já existe devolve também
`playbookKey`, validado contra o catálogo. O catálogo mostra ao classificador apenas chave, rótulo
e `appliesTo` — mandar o conteúdo de todos os playbooks para escolher UM encareceria a cada
playbook novo.

**Alvo por faceta.** Cada princípio declara em que faceta entra, e o bloco calcula um alvo em
número. É o que faz o modelo cobrir o playbook inteiro em vez de parar na cobertura mínima. O alvo
é piso, não teto, e SOMA o playbook de papel com o `core.conduct` — contados em separado, a
conduta universal perdia a disputa por cota em silêncio.

**Só em tempo de projeto.** O prompt publicado continua compilado do canônico (invariante 7). O
que persiste no agente é `playbookKey`, como proveniência: é ela que faz o refinamento acontecer
com o mesmo ofício com que o agente nasceu.

---

## 20. Administração da plataforma

Rotas sob `/api/admin`, atrás de `authenticate` + `requireRole('ADMIN')`. `UserRole.ADMIN` é papel
de **plataforma** e não se confunde com `MembershipRole` (o papel dentro de UMA conta): o dono de
uma conta não pode alterar o ofício que os agentes de todas as outras herdam. Esconder a rota no
frontend é conveniência; o guard real é o da API.

**Salvar é criar versão.** `PUT /admin/playbooks/:key` grava `versionNumber + 1` e move o ponteiro.
Nunca sobrescreve — curadoria de ofício é opinião sobre como um profissional trabalha, e opinião
erra; sobrescrever tiraria a única saída, que é voltar para a anterior. O motivo da versão é
obrigatório: histórico sem motivo é o mesmo que não ter histórico.

**A pauta exige elevação.** `GET /admin/playbook-misses` agrega `PlaybookMiss` de TODAS as contas —
um papel pedido na conta A é o sinal de que falta playbook para todas. O `tenantGuard` barra isso
por padrão, e corretamente; a saída não é afrouxar a classificação do modelo, é `elevateScope` com
motivo explícito e registro em `AuditLog` (`ADMIN_PLAYBOOK_MISSES_READ`).

**Destilação.** `POST /admin/playbooks/distill` recebe o documento bruto e devolve um RASCUNHO
estruturado — não grava. O admin traz o estudo; o sistema separa ofício transferível de arquitetura
de produto e devolve a destilação. É o mesmo pipeline do resto: a LLM propõe, o schema valida, uma
pessoa aprova. O documento entra como bloco `UNTRUSTED`: ele pode conter qualquer coisa, inclusive
texto que pareça instrução.

Medido com o estudo real de 59.535 caracteres: 6s, 12 princípios distribuídos pelas seis facetas,
6 limites, 5 fontes.
