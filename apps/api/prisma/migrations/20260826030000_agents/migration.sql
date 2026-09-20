-- CreateTable
CREATE TABLE `agents` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `role` VARCHAR(160) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `currentVersionId` CHAR(26) NULL,
    `lockVersion` INTEGER NOT NULL DEFAULT 0,
    `createdBy` CHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `agents_accountId_status_createdAt_idx`(`accountId`, `status`, `createdAt`),
    UNIQUE INDEX `agents_accountId_slug_key`(`accountId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_versions` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `agentId` CHAR(26) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `canonicalConfig` JSON NOT NULL,
    `canonicalSchemaVersion` INTEGER NOT NULL,
    `humanSummary` JSON NOT NULL,
    `source` ENUM('USER', 'MYAIHUB', 'SYSTEM') NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `previousVersionId` CHAR(26) NULL,
    `createdBy` CHAR(26) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_versions_accountId_createdAt_idx`(`accountId`, `createdAt`),
    UNIQUE INDEX `agent_versions_agentId_versionNumber_key`(`agentId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `agents_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_versions` ADD CONSTRAINT `agent_versions_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
