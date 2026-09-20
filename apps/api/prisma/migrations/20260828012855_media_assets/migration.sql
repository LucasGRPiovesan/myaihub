-- AlterTable
ALTER TABLE `hub_messages` ADD COLUMN `attachments` JSON NULL;

-- CreateTable
CREATE TABLE `media_assets` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `storageKey` VARCHAR(300) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `uploadedBy` CHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `media_assets_accountId_createdAt_idx`(`accountId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
