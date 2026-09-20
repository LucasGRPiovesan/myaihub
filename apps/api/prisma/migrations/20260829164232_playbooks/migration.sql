-- CreateTable
CREATE TABLE `playbooks` (
    `id` CHAR(26) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `currentVersionId` CHAR(26) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `playbooks_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `playbook_versions` (
    `id` CHAR(26) NOT NULL,
    `playbookId` CHAR(26) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `content` JSON NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `playbook_versions_playbookId_versionNumber_key`(`playbookId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `playbook_misses` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `role` VARCHAR(300) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `playbook_misses_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `playbook_versions` ADD CONSTRAINT `playbook_versions_playbookId_fkey` FOREIGN KEY (`playbookId`) REFERENCES `playbooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
