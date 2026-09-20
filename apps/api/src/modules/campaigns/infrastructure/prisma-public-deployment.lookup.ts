import {
  BRAND_IDENTITY_SCHEMAS,
  parseCanonical,
  PROJECT_PROFILE_SCHEMAS,
  type CanonicalAgent,
  type CanonicalBrandIdentity,
  type CanonicalCampaign,
  type CanonicalProjectProfile,
} from '@myaihub/shared';
import {
  publicTenantContext,
  runWithTenantContext,
  systemTenantContext,
} from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import { readManifest } from '../domain/manifest.js';
import type { PublicDeploymentLookup } from '../domain/repositories.js';

/**
 * Resolve o endereço público até a configuração CONGELADA.
 *
 * A primeira consulta roda ANTES de existir tenant — é ela que descobre o
 * `accountId` — e por isso é a única do sistema nessa condição. É estreita de
 * propósito: chave única `publicId`, deployment ATIVO, e nada mais entra por
 * parâmetro. A partir daí tudo volta ao normal, dentro de
 * `publicTenantContext`, com o guard do Prisma valendo.
 *
 * E carrega pelo MANIFEST, não pelo ponteiro atual. É a invariante 7 em código:
 * `agentVersionId` e `campaignVersionId` vêm congelados na publicação, então
 * editar o agente agora não muda uma vírgula do que o público recebe. Ler as
 * versões correntes aqui seria transformar "publicação imutável" em promessa
 * de documentação.
 */
export class PrismaPublicDeploymentLookup implements PublicDeploymentLookup {
  constructor(private readonly db: Db) {}

  async findActiveByPublicId(publicId: string): Promise<{
    accountId: string;
    campaignId: string;
    deploymentId: string;
    projectId: string;
    agentId: string;
    campaignName: string;
    agent: CanonicalAgent;
    campaign: CanonicalCampaign;
    project: CanonicalProjectProfile | null;
    brand: CanonicalBrandIdentity | null;
    knowledgeSnapshotId: string | null;
  } | null> {
    // O ÚNICO ponto do sistema que consulta antes de existir tenant — é esta
    // consulta que DESCOBRE o accountId. O guard do Prisma barra qualquer
    // leitura tenant-scoped sem contexto, e está certo: a saída não é
    // contorná-lo, é declarar o bootstrap com motivo.
    //
    // Ela é estreita por construção e precisa continuar assim: chave única
    // `publicId`, quatro colunas, nada vindo de fora além do endereço. Uma
    // consulta elevada que aceitasse filtro do request seria a porta dos fundos
    // do multi-tenant.
    const campaign = await runWithTenantContext(
      systemTenantContext('Public Chat: resolver publicId → accountId antes de existir tenant.'),
      () =>
        this.db.campaign.findUnique({
          where: { publicId },
          select: { id: true, accountId: true, name: true, projectId: true },
        }),
    );
    if (!campaign) return null;

    const context = publicTenantContext(campaign.accountId);

    return runWithTenantContext(context, async () => {
      const deployment = await this.db.campaignPublicDeployment.findFirst({
        where: { campaignId: campaign.id, accountId: campaign.accountId, status: 'ACTIVE' },
        orderBy: { deploymentNumber: 'desc' },
      });
      if (!deployment) return null;

      // Migrado na LEITURA, como todo documento versionado do sistema (§5.3).
      // Um deployment publicado antes da Fase 5 foi gravado no manifest v1 e
      // é IMUTÁVEL — reescrevê-lo para "arrumar o formato" desfaria a única
      // coisa que ele existe para garantir.
      const manifest = readManifest(deployment.manifest);

      const [agentVersion, campaignVersion] = await Promise.all([
        this.db.agentVersion.findFirst({
          where: { id: manifest.agentVersionId, accountId: campaign.accountId },
          select: { canonicalConfig: true },
        }),
        this.db.campaignVersion.findFirst({
          where: { id: manifest.campaignVersionId, accountId: campaign.accountId },
          select: { canonicalConfig: true },
        }),
      ]);

      // Versão congelada que sumiu é publicação inconsistente, não "vazia": a
      // exclusão de agente é barrada justamente por deployment ativo. Sair como
      // indisponível é o único desfecho honesto.
      if (!agentVersion || !campaignVersion) return null;

      const [profile, brand] = await Promise.all([
        manifest.projectProfileVersionId
          ? this.db.projectProfileVersion.findFirst({
              where: { id: manifest.projectProfileVersionId, accountId: campaign.accountId },
              select: { canonicalConfig: true },
            })
          : null,
        manifest.brandIdentityVersionId
          ? this.db.projectBrandIdentityVersion.findFirst({
              where: { id: manifest.brandIdentityVersionId, accountId: campaign.accountId },
              select: { canonicalConfig: true },
            })
          : null,
      ]);

      return {
        accountId: campaign.accountId,
        campaignId: campaign.id,
        deploymentId: deployment.id,
        projectId: campaign.projectId,
        agentId: manifest.agentId,
        campaignName: campaign.name,
        agent: agentVersion.canonicalConfig as unknown as CanonicalAgent,
        campaign: campaignVersion.canonicalConfig as unknown as CanonicalCampaign,
        // Migrado na LEITURA. A publicação congela um documento na versão em
        // que ele foi escrito, então um deployment antigo entrega um perfil v1 —
        // e ler v1 como v2 daria facetas `undefined` no compilador do prompt.
        project: profile ? parseCanonical(profile.canonicalConfig, PROJECT_PROFILE_SCHEMAS) : null,
        brand: brand ? parseCanonical(brand.canonicalConfig, BRAND_IDENTITY_SCHEMAS) : null,
        // O snapshot é do MANIFEST, não do projeto: reindexar uma fonte hoje
        // não pode mudar o que uma publicação de ontem responde.
        knowledgeSnapshotId: manifest.knowledgeSnapshotId,
      };
    });
  }
}
