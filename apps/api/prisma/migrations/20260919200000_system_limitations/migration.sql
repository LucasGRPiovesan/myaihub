-- Pauta de suporte: o que o S.O não conseguiu fazer por limite do sistema.
CREATE TABLE `system_limitations` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `userId` CHAR(26) NULL,
    `hubOperationId` CHAR(26) NULL,
    `operation` VARCHAR(60) NOT NULL,
    `summary` VARCHAR(300) NOT NULL,
    `need` VARCHAR(600) NOT NULL,
    `userMessage` VARCHAR(1000) NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `resolutionNote` VARCHAR(600) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `system_limitations_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `system_limitations_accountId_createdAt_idx`(`accountId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
