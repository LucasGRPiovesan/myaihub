-- AlterTable
ALTER TABLE `agents` ADD COLUMN `playbookKey` VARCHAR(60) NULL;

-- CreateTable
CREATE TABLE `playbook_suggestions` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `playbookKey` VARCHAR(60) NOT NULL,
    `agentId` CHAR(26) NOT NULL,
    `summary` VARCHAR(300) NOT NULL,
    `statement` TEXT NOT NULL,
    `facet` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `playbook_suggestions_playbookKey_createdAt_idx`(`playbookKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `agents_playbookKey_idx` ON `agents`(`playbookKey`);
