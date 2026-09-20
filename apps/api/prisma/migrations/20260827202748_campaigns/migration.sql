-- CreateTable
CREATE TABLE `campaigns` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `projectId` CHAR(26) NOT NULL,
    `agentId` CHAR(26) NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(140) NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publicId` CHAR(26) NULL,
    `currentVersionId` CHAR(26) NULL,
    `lockVersion` INTEGER NOT NULL DEFAULT 0,
    `createdBy` CHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `campaigns_publicId_key`(`publicId`),
    INDEX `campaigns_accountId_status_createdAt_idx`(`accountId`, `status`, `createdAt`),
    INDEX `campaigns_accountId_projectId_createdAt_idx`(`accountId`, `projectId`, `createdAt`),
    INDEX `campaigns_accountId_agentId_idx`(`accountId`, `agentId`),
    UNIQUE INDEX `campaigns_projectId_slug_key`(`projectId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_versions` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `campaignId` CHAR(26) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `canonicalConfig` JSON NOT NULL,
    `canonicalSchemaVersion` INTEGER NOT NULL,
    `humanSummary` JSON NOT NULL,
    `source` ENUM('USER', 'MYAIHUB', 'SYSTEM') NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `previousVersionId` CHAR(26) NULL,
    `createdBy` CHAR(26) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `campaign_versions_accountId_createdAt_idx`(`accountId`, `createdAt`),
    UNIQUE INDEX `campaign_versions_campaignId_versionNumber_key`(`campaignId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_public_deployments` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `campaignId` CHAR(26) NOT NULL,
    `deploymentNumber` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'SUPERSEDED', 'PAUSED') NOT NULL DEFAULT 'ACTIVE',
    `campaignVersionId` CHAR(26) NOT NULL,
    `manifest` JSON NOT NULL,
    `manifestHash` CHAR(64) NOT NULL,
    `publishedBy` CHAR(26) NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `supersededAt` DATETIME(3) NULL,

    INDEX `campaign_public_deployments_accountId_status_publishedAt_idx`(`accountId`, `status`, `publishedAt`),
    INDEX `campaign_public_deployments_campaignId_status_idx`(`campaignId`, `status`),
    UNIQUE INDEX `campaign_public_deployments_campaignId_deploymentNumber_key`(`campaignId`, `deploymentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_versions` ADD CONSTRAINT `campaign_versions_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_public_deployments` ADD CONSTRAINT `campaign_public_deployments_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_public_deployments` ADD CONSTRAINT `campaign_public_deployments_campaignVersionId_fkey` FOREIGN KEY (`campaignVersionId`) REFERENCES `campaign_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
