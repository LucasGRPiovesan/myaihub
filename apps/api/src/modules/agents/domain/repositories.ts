import type { CanonicalAgent } from '@myaihub/shared';
import type { AuditEntry } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { ConfigurationChangeInput } from '../../projects/domain/repositories.js';
import type { AgentMutation } from './mutations.js';

export interface AgentRecord {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  currentVersionId: string | null;
  lockVersion: number;
  createdAt: Date;
}

export interface AgentVersionRecord {
  id: string;
  agentId: string;
  versionNumber: number;
  canonicalConfig: CanonicalAgent;
  humanSummary: string[];
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: Date;
}

export interface AgentWithVersion {
  agent: AgentRecord;
  version: AgentVersionRecord | null;
}

type AgentChange = Omit<ConfigurationChangeInput, 'entityType' | 'mutations'> & {
  entityType: 'AGENT';
  mutations: AgentMutation[];
};

export interface CreateAgentInput {
  agent: { id: string; name: string; slugBase: string; role: string; createdBy: string };
  version: {
    id: string;
    canonicalConfig: CanonicalAgent;
    humanSummary: string[];
    source: 'USER' | 'MYAIHUB' | 'SYSTEM';
    reason: string;
  };
  change: Omit<
    AgentChange,
    'entityId' | 'toVersionId' | 'toVersion' | 'fromVersionId' | 'fromVersion'
  >;
  audit: Omit<AuditEntry, 'entityId'>;
}

export interface UpdateAgentInput {
  agentId: string;
  expectedLockVersion: number;
  version: {
    id: string;
    canonicalConfig: CanonicalAgent;
    humanSummary: string[];
    source: 'USER' | 'MYAIHUB' | 'SYSTEM';
    reason: string;
  };
  change: Omit<AgentChange, 'entityId' | 'toVersionId' | 'toVersion'>;
  audit: AuditEntry;
}

export interface AgentRepository {
  /** Cria Agent + primeira versão + change + auditoria, atômico. */
  create(context: TenantContext, input: CreateAgentInput): Promise<AgentWithVersion>;

  /** Nova versão + ponteiro + change + auditoria, com lock otimista. */
  updateConfiguration(context: TenantContext, input: UpdateAgentInput): Promise<AgentWithVersion>;

  findById(context: TenantContext, id: string): Promise<AgentWithVersion | null>;

  list(context: TenantContext, limit: number, cursor: string | null): Promise<AgentRecord[]>;

  listVersions(
    context: TenantContext,
    agentId: string,
    limit: number,
  ): Promise<AgentVersionRecord[]>;

  /**
   * Remove o agente e suas versões.
   *
   * Só é chamado depois que o caso de uso confirmou que nada aponta para ele —
   * o repositório não decide consistência de negócio.
   */
  delete(context: TenantContext, id: string): Promise<void>;

  /** Restaura uma versão anterior criando uma NOVA versão (§18). */
  findVersion(
    context: TenantContext,
    agentId: string,
    versionNumber: number,
  ): Promise<AgentVersionRecord | null>;
}
