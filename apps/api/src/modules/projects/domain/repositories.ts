import type { CanonicalProjectProfile } from '@myaihub/shared';
import type { AuditEntry } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { CanonicalMutation } from '../../myaihub/domain/mutations.js';

export interface ProjectRecord {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'ARCHIVED';
  currentProfileVersionId: string | null;
  lockVersion: number;
  createdAt: Date;
}

export interface ProjectProfileVersionRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  canonicalConfig: CanonicalProjectProfile;
  humanSummary: string[];
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: Date;
}

export interface ProjectWithProfile {
  project: ProjectRecord;
  profile: ProjectProfileVersionRecord | null;
}

/**
 * Registro da MUDANÇA que produziu a versão (§4.2).
 *
 * Gravado na MESMA transação da versão e do ponteiro. Não duplica o documento
 * canônico — guarda só o delta semântico e a proveniência.
 */
export interface ConfigurationChangeInput {
  id: string;
  entityType: 'PROJECT_PROFILE';
  entityId: string;
  fromVersionId: string | null;
  fromVersion: number | null;
  toVersionId: string;
  toVersion: number;
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  actorUserId: string | null;
  hubOperationId: string | null;
  hubMessageId: string | null;
  interpretedIntent: string;
  mutations: CanonicalMutation[];
  rationale: string;
}

export interface CreateProjectInput {
  project: { id: string; name: string; slugBase: string; createdBy: string };
  profileVersion: {
    id: string;
    canonicalConfig: CanonicalProjectProfile;
    humanSummary: string[];
    source: 'USER' | 'MYAIHUB' | 'SYSTEM';
    reason: string;
  };
  capability: { id: string; type: 'CAMPAIGNS' };
  change: Omit<
    ConfigurationChangeInput,
    'entityId' | 'toVersionId' | 'toVersion' | 'fromVersionId' | 'fromVersion'
  >;
  audit: Omit<AuditEntry, 'entityId'>;
}

export interface UpdateProfileInput {
  projectId: string;
  /** Versão lida pelo chamador. Divergiu? Alguém alterou no meio (§70). */
  expectedLockVersion: number;
  profileVersion: {
    id: string;
    canonicalConfig: CanonicalProjectProfile;
    humanSummary: string[];
    source: 'USER' | 'MYAIHUB' | 'SYSTEM';
    reason: string;
  };
  change: Omit<ConfigurationChangeInput, 'entityId' | 'toVersionId' | 'toVersion'>;
  audit: AuditEntry;
}

export interface ProjectRepository {
  /** Cria Project + versão do perfil + capability + change + auditoria, atômico. */
  create(context: TenantContext, input: CreateProjectInput): Promise<ProjectWithProfile>;

  /** Nova versão + ponteiro + change + auditoria, atômico e com lock otimista. */
  updateProfile(context: TenantContext, input: UpdateProfileInput): Promise<ProjectWithProfile>;

  findById(context: TenantContext, id: string): Promise<ProjectWithProfile | null>;

  list(context: TenantContext, limit: number, cursor: string | null): Promise<ProjectRecord[]>;

  countForAccount(context: TenantContext): Promise<number>;

  listVersions(
    context: TenantContext,
    projectId: string,
    limit: number,
  ): Promise<ProjectProfileVersionRecord[]>;
}
