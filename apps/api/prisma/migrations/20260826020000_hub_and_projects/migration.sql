-- CreateTable
CREATE TABLE `projects` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(140) NOT NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `currentProfileVersionId` CHAR(26) NULL,
    `lockVersion` INTEGER NOT NULL DEFAULT 0,
    `createdBy` CHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `projects_accountId_status_createdAt_idx`(`accountId`, `status`, `createdAt`),
    UNIQUE INDEX `projects_accountId_slug_key`(`accountId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_profile_versions` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `projectId` CHAR(26) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `canonicalConfig` JSON NOT NULL,
    `canonicalSchemaVersion` INTEGER NOT NULL,
    `humanSummary` JSON NOT NULL,
    `source` ENUM('USER', 'MYAIHUB', 'SYSTEM') NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `previousVersionId` CHAR(26) NULL,
    `createdBy` CHAR(26) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_profile_versions_accountId_createdAt_idx`(`accountId`, `createdAt`),
    UNIQUE INDEX `project_profile_versions_projectId_versionNumber_key`(`projectId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_capabilities` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `projectId` CHAR(26) NOT NULL,
    `type` ENUM('CAMPAIGNS') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `settings` JSON NULL,
    `enabledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_capabilities_accountId_type_idx`(`accountId`, `type`),
    UNIQUE INDEX `project_capabilities_projectId_type_key`(`projectId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hub_policies` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `currentVersionId` CHAR(26) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hub_policies_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hub_policy_versions` (
    `id` CHAR(26) NOT NULL,
    `policyId` CHAR(26) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `sections` JSON NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hub_policy_versions_policyId_versionNumber_key`(`policyId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hub_conversations` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `userId` CHAR(26) NOT NULL,
    `scope` ENUM('ROOT', 'PROJECT', 'AGENT', 'CAMPAIGN') NOT NULL,
    `scopeId` CHAR(26) NULL,
    `title` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hub_conversations_accountId_userId_updatedAt_idx`(`accountId`, `userId`, `updatedAt`),
    INDEX `hub_conversations_accountId_scope_scopeId_idx`(`accountId`, `scope`, `scopeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hub_messages` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `conversationId` CHAR(26) NOT NULL,
    `role` ENUM('USER', 'ASSISTANT') NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hub_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hub_operations` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `conversationId` CHAR(26) NOT NULL,
    `operation` VARCHAR(60) NOT NULL,
    `status` ENUM('RUNNING', 'COMPLETED', 'FAILED', 'AWAITING_CONFIRMATION') NOT NULL DEFAULT 'RUNNING',
    `triggeredByMessageId` CHAR(26) NULL,
    `policyVersionId` CHAR(26) NULL,
    `policySections` JSON NULL,
    `errorCode` VARCHAR(60) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hub_operations_accountId_createdAt_idx`(`accountId`, `createdAt`),
    INDEX `hub_operations_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hub_operation_events` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `operationId` CHAR(26) NOT NULL,
    `seq` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hub_operation_events_operationId_seq_key`(`operationId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuration_proposals` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `operationId` CHAR(26) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` CHAR(26) NOT NULL,
    `mutations` JSON NOT NULL,
    `interpretedIntent` VARCHAR(300) NOT NULL,
    `rationale` TEXT NOT NULL,
    `humanSummary` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `decidedBy` CHAR(26) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `configuration_proposals_accountId_status_createdAt_idx`(`accountId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuration_changes` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` CHAR(26) NOT NULL,
    `fromVersionId` CHAR(26) NULL,
    `toVersionId` CHAR(26) NOT NULL,
    `fromVersion` INTEGER NULL,
    `toVersion` INTEGER NOT NULL,
    `source` ENUM('USER', 'MYAIHUB', 'SYSTEM') NOT NULL,
    `actorUserId` CHAR(26) NULL,
    `hubOperationId` CHAR(26) NULL,
    `hubMessageId` CHAR(26) NULL,
    `interpretedIntent` VARCHAR(300) NOT NULL,
    `mutations` JSON NOT NULL,
    `rationale` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `configuration_changes_accountId_entityType_entityId_createdA_idx`(`accountId`, `entityType`, `entityId`, `createdAt`),
    INDEX `configuration_changes_accountId_createdAt_idx`(`accountId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_profile_versions` ADD CONSTRAINT `project_profile_versions_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_capabilities` ADD CONSTRAINT `project_capabilities_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hub_policy_versions` ADD CONSTRAINT `hub_policy_versions_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `hub_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hub_messages` ADD CONSTRAINT `hub_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `hub_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hub_operations` ADD CONSTRAINT `hub_operations_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `hub_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hub_operation_events` ADD CONSTRAINT `hub_operation_events_operationId_fkey` FOREIGN KEY (`operationId`) REFERENCES `hub_operations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_proposals` ADD CONSTRAINT `configuration_proposals_operationId_fkey` FOREIGN KEY (`operationId`) REFERENCES `hub_operations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_changes` ADD CONSTRAINT `configuration_changes_hubOperationId_fkey` FOREIGN KEY (`hubOperationId`) REFERENCES `hub_operations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
