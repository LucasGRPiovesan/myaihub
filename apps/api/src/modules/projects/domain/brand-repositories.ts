import type { CanonicalBrandIdentity } from '@myaihub/shared';
import type { AuditEntry } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { CanonicalMutation } from '../../myaihub/domain/mutations.js';
import type { ConfigurationChangeInput } from './repositories.js';

export interface BrandIdentityVersionRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  canonicalConfig: CanonicalBrandIdentity;
  humanSummary: string[];
  source: 'USER' | 'MYAIHUB' | 'SYSTEM';
  reason: string;
  createdAt: Date;
}

export interface UpdateBrandIdentityInput {
  projectId: string;
  /** Versão lida pelo chamador. Divergiu? Alguém alterou no meio (§70). */
  expectedLockVersion: number;
  version: {
    id: string;
    canonicalConfig: CanonicalBrandIdentity;
    humanSummary: string[];
    source: 'USER' | 'MYAIHUB' | 'SYSTEM';
    reason: string;
  };
  change: Omit<
    ConfigurationChangeInput,
    'entityId' | 'toVersionId' | 'toVersion' | 'entityType'
  > & {
    entityType: 'PROJECT_BRAND_IDENTITY';
    mutations: CanonicalMutation[];
  };
  audit: AuditEntry;
}

/**
 * Identidade de marca do projeto (§4.4, Fase 5).
 *
 * Repositório PRÓPRIO, e não mais campos dentro do perfil: as duas coisas mudam
 * por motivos diferentes e em ritmos diferentes. Trocar a cor da marca não pode
 * criar uma versão do documento que descreve o que o negócio vende — o
 * histórico do perfil deixaria de contar uma história.
 */
export interface BrandIdentityRepository {
  /** Nova versão + ponteiro + change + auditoria, atômico e com lock otimista. */
  update(
    context: TenantContext,
    input: UpdateBrandIdentityInput,
  ): Promise<BrandIdentityVersionRecord>;

  /** `null` quando o projeto ainda não definiu identidade nenhuma. */
  findCurrent(
    context: TenantContext,
    projectId: string,
  ): Promise<BrandIdentityVersionRecord | null>;

  findVersion(context: TenantContext, id: string): Promise<BrandIdentityVersionRecord | null>;

  listVersions(
    context: TenantContext,
    projectId: string,
    limit: number,
  ): Promise<BrandIdentityVersionRecord[]>;
}
