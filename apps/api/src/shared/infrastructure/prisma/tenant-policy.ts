/**
 * Classificação de tenant de cada modelo Prisma.
 *
 * O tenantGuard falha fechado: um modelo AUSENTE deste registro faz qualquer
 * query contra ele lançar. Ou seja, criar um modelo novo no schema sem
 * classificá-lo aqui quebra em desenvolvimento imediatamente — que é
 * exatamente o comportamento desejado.
 *
 * Ver docs/ARCHITECTURE.md §12.
 */
export type ModelTenantScope =
  /** Pertence a uma Account. Toda query precisa de accountId (ou escopo elevado). */
  | 'TENANT_SCOPED'
  /** Não pertence a um tenant, ou é consultado antes de existir tenant. */
  | 'UNSCOPED';

export interface ModelTenantPolicy {
  scope: ModelTenantScope;
  /** Justificativa. Obrigatória para UNSCOPED — é o que impede uso preguiçoso. */
  note: string;
}

export const TENANT_MODEL_POLICY: Readonly<Record<string, ModelTenantPolicy>> = {
  Account: {
    scope: 'UNSCOPED',
    note: 'É o próprio tenant. O acesso é controlado por membership, no use case.',
  },
  User: {
    scope: 'UNSCOPED',
    note: 'Identidade global; buscado por e-mail no login, antes de existir tenant.',
  },
  AccountMembership: {
    scope: 'UNSCOPED',
    note: 'É a tabela que RESOLVE o tenant. Consultada por userId antes de haver escopo.',
  },
  RefreshToken: {
    scope: 'UNSCOPED',
    note: 'Buscado por hash do token no refresh, antes de resolver a sessão e o tenant.',
  },
  AuditLog: {
    scope: 'TENANT_SCOPED',
    note: '',
  },
  AiModelPricing: {
    scope: 'UNSCOPED',
    note: 'Tabela de preços da plataforma, igual para todas as contas. Não pertence a tenant.',
  },
  Project: { scope: 'TENANT_SCOPED', note: '' },
  Agent: { scope: 'TENANT_SCOPED', note: '' },
  AgentVersion: { scope: 'TENANT_SCOPED', note: '' },
  ProjectProfileVersion: { scope: 'TENANT_SCOPED', note: '' },
  ProjectCapability: { scope: 'TENANT_SCOPED', note: '' },
  MediaAsset: { scope: 'TENANT_SCOPED', note: '' },
  Campaign: { scope: 'TENANT_SCOPED', note: '' },
  CampaignVersion: { scope: 'TENANT_SCOPED', note: '' },
  CampaignPublicDeployment: { scope: 'TENANT_SCOPED', note: '' },
  HubConversation: { scope: 'TENANT_SCOPED', note: '' },
  HubMessage: { scope: 'TENANT_SCOPED', note: '' },
  HubOperation: { scope: 'TENANT_SCOPED', note: '' },
  HubOperationEvent: { scope: 'TENANT_SCOPED', note: '' },
  ConfigurationProposal: { scope: 'TENANT_SCOPED', note: '' },
  ConfigurationChange: { scope: 'TENANT_SCOPED', note: '' },
  HubPolicy: {
    scope: 'UNSCOPED',
    note: 'Policy do MyAIHub OS é da plataforma, igual para todas as contas.',
  },
  HubPolicyVersion: {
    scope: 'UNSCOPED',
    note: 'Versão da policy da plataforma. Ver HubPolicy.',
  },
  ModelRoute: {
    scope: 'UNSCOPED',
    note: 'Qual modelo atende cada papel é decisão da PLATAFORMA, não de uma conta.',
  },
  AiProviderSetting: {
    scope: 'UNSCOPED',
    note: 'Provider ligado/desligado é decisão da PLATAFORMA, como o Model Route.',
  },
  AiProviderCredential: {
    scope: 'UNSCOPED',
    note: 'A chave de um provider é da PLATAFORMA inteira, cifrada em repouso.',
  },
  Playbook: {
    scope: 'UNSCOPED',
    note: 'Ofício é conhecimento da plataforma: o mesmo playbook vale para toda conta.',
  },
  PlaybookVersion: {
    scope: 'UNSCOPED',
    note: 'Versão do playbook da plataforma. Ver Playbook.',
  },
  PlaybookSuggestion: {
    scope: 'TENANT_SCOPED',
    note: '',
  },
  PlaybookMiss: {
    scope: 'TENANT_SCOPED',
    note: '',
  },
  SystemLimitation: {
    scope: 'TENANT_SCOPED',
    note: '',
  },
  AiCall: {
    scope: 'TENANT_SCOPED',
    note: '',
  },
  ExecutionTrace: {
    scope: 'TENANT_SCOPED',
    note: '',
  },
  ProjectBrandIdentityVersion: { scope: 'TENANT_SCOPED', note: '' },
  ProjectKnowledgeSource: { scope: 'TENANT_SCOPED', note: '' },
  KnowledgeRevision: { scope: 'TENANT_SCOPED', note: '' },
  KnowledgeSnapshot: { scope: 'TENANT_SCOPED', note: '' },
  KnowledgeSnapshotItem: { scope: 'TENANT_SCOPED', note: '' },
  // O chat público escreve nestas quatro sem usuário autenticado. Continuam
  // TENANT_SCOPED: quem resolve o tenant é o publicId, no servidor, e é o
  // `publicTenantContext` que o guard exige — não uma exceção aqui.
  ConversationSession: { scope: 'TENANT_SCOPED', note: '' },
  ConversationMessage: { scope: 'TENANT_SCOPED', note: '' },
  ConversationState: { scope: 'TENANT_SCOPED', note: '' },
  SessionEvent: { scope: 'TENANT_SCOPED', note: '' },
};

export function getModelTenantPolicy(model: string): ModelTenantPolicy | undefined {
  return TENANT_MODEL_POLICY[model];
}
