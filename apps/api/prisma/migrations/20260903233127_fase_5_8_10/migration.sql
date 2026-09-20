-- AlterTable
ALTER TABLE `projects` ADD COLUMN `currentBrandIdentityVersionId` CHAR(26) NULL;

-- CreateTable
CREATE TABLE `project_brand_identity_versions` (
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

    INDEX `project_brand_identity_versions_accountId_createdAt_idx`(`accountId`, `createdAt`),
    UNIQUE INDEX `project_brand_identity_versions_projectId_versionNumber_key`(`projectId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_knowledge_sources` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `projectId` CHAR(26) NOT NULL,
    `kind` ENUM('TEXT', 'URL') NOT NULL,
    `status` ENUM('PENDING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `title` VARCHAR(200) NOT NULL,
    `uri` VARCHAR(2000) NULL,
    `currentRevisionId` CHAR(26) NULL,
    `lastError` VARCHAR(300) NULL,
    `createdBy` CHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_knowledge_sources_accountId_projectId_createdAt_idx`(`accountId`, `projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_revisions` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `sourceId` CHAR(26) NOT NULL,
    `revisionNumber` INTEGER NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `extractedContent` MEDIUMTEXT NOT NULL,
    `contentLength` INTEGER NOT NULL,
    `extractedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `knowledge_revisions_accountId_extractedAt_idx`(`accountId`, `extractedAt`),
    UNIQUE INDEX `knowledge_revisions_sourceId_revisionNumber_key`(`sourceId`, `revisionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_snapshots` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `projectId` CHAR(26) NOT NULL,
    `itemCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `knowledge_snapshots_accountId_projectId_createdAt_idx`(`accountId`, `projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_snapshot_items` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `snapshotId` CHAR(26) NOT NULL,
    `sourceId` CHAR(26) NOT NULL,
    `revisionId` CHAR(26) NOT NULL,

    INDEX `knowledge_snapshot_items_accountId_snapshotId_idx`(`accountId`, `snapshotId`),
    UNIQUE INDEX `knowledge_snapshot_items_snapshotId_sourceId_key`(`snapshotId`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_sessions` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `channel` ENUM('PUBLIC', 'LAB') NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `campaignId` CHAR(26) NULL,
    `deploymentId` CHAR(26) NULL,
    `projectId` CHAR(26) NULL,
    `agentId` CHAR(26) NOT NULL,
    `visitorKey` CHAR(64) NULL,
    `scenario` TEXT NULL,
    `messageCount` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `costMicros` BIGINT NOT NULL DEFAULT 0,
    `violationCount` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    INDEX `conversation_sessions_accountId_channel_startedAt_idx`(`accountId`, `channel`, `startedAt`),
    INDEX `conversation_sessions_accountId_campaignId_startedAt_idx`(`accountId`, `campaignId`, `startedAt`),
    INDEX `conversation_sessions_accountId_agentId_startedAt_idx`(`accountId`, `agentId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_messages` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `sessionId` CHAR(26) NOT NULL,
    `seq` INTEGER NOT NULL,
    `role` ENUM('VISITOR', 'AGENT') NOT NULL,
    `content` TEXT NOT NULL,
    `violations` JSON NULL,
    `aiCallId` CHAR(26) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `conversation_messages_accountId_createdAt_idx`(`accountId`, `createdAt`),
    UNIQUE INDEX `conversation_messages_sessionId_seq_key`(`sessionId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_states` (
    `sessionId` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `facts` JSON NOT NULL,
    `signals` JSON NOT NULL,
    `progress` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `conversation_states_accountId_updatedAt_idx`(`accountId`, `updatedAt`),
    PRIMARY KEY (`sessionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session_events` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `sessionId` CHAR(26) NOT NULL,
    `type` ENUM('SESSION_STARTED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'RULE_VIOLATION', 'CTA_OFFERED', 'OBJECTIVE_REACHED', 'SESSION_ENDED') NOT NULL,
    `source` ENUM('OBSERVED', 'DECLARED') NOT NULL DEFAULT 'OBSERVED',
    `campaignId` CHAR(26) NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_events_accountId_type_createdAt_idx`(`accountId`, `type`, `createdAt`),
    INDEX `session_events_accountId_campaignId_createdAt_idx`(`accountId`, `campaignId`, `createdAt`),
    INDEX `session_events_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_brand_identity_versions` ADD CONSTRAINT `project_brand_identity_versions_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_knowledge_sources` ADD CONSTRAINT `project_knowledge_sources_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_revisions` ADD CONSTRAINT `knowledge_revisions_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `project_knowledge_sources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_snapshots` ADD CONSTRAINT `knowledge_snapshots_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_snapshot_items` ADD CONSTRAINT `knowledge_snapshot_items_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `knowledge_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_snapshot_items` ADD CONSTRAINT `knowledge_snapshot_items_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `project_knowledge_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_snapshot_items` ADD CONSTRAINT `knowledge_snapshot_items_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `knowledge_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_sessions` ADD CONSTRAINT `conversation_sessions_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_messages` ADD CONSTRAINT `conversation_messages_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `conversation_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_states` ADD CONSTRAINT `conversation_states_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `conversation_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_events` ADD CONSTRAINT `session_events_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `conversation_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
