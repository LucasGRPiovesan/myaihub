-- CreateTable
CREATE TABLE `accounts` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(140) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounts_slug_key`(`slug`),
    INDEX `accounts_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_memberships` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `userId` CHAR(26) NOT NULL,
    `role` ENUM('OWNER', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_memberships_userId_idx`(`userId`),
    UNIQUE INDEX `account_memberships_accountId_userId_key`(`accountId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(26) NOT NULL,
    `sessionId` CHAR(26) NOT NULL,
    `userId` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedById` CHAR(26) NULL,
    `userAgent` VARCHAR(400) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `refresh_tokens_sessionId_idx`(`sessionId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `actorUserId` CHAR(26) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` CHAR(26) NULL,
    `metadata` JSON NULL,
    `requestId` VARCHAR(40) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_accountId_createdAt_idx`(`accountId`, `createdAt`),
    INDEX `audit_logs_accountId_entityType_entityId_idx`(`accountId`, `entityType`, `entityId`),
    INDEX `audit_logs_accountId_action_createdAt_idx`(`accountId`, `action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `account_memberships` ADD CONSTRAINT `account_memberships_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_memberships` ADD CONSTRAINT `account_memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

