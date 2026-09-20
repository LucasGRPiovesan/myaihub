-- CreateTable
CREATE TABLE `ai_model_pricing` (
    `id` CHAR(26) NOT NULL,
    `provider` ENUM('FAKE', 'GEMINI', 'OPENAI', 'ANTHROPIC') NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `inputMicros` BIGINT NOT NULL,
    `cachedInputMicros` BIGINT NOT NULL DEFAULT 0,
    `cacheWriteMicros` BIGINT NOT NULL DEFAULT 0,
    `outputMicros` BIGINT NOT NULL,
    `reasoningMicros` BIGINT NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `effectiveFrom` DATETIME(3) NOT NULL,
    `sourceLabel` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_model_pricing_provider_model_effectiveFrom_idx`(`provider`, `model`, `effectiveFrom`),
    UNIQUE INDEX `ai_model_pricing_provider_model_effectiveFrom_key`(`provider`, `model`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_calls` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `role` VARCHAR(40) NOT NULL,
    `provider` ENUM('FAKE', 'GEMINI', 'OPENAI', 'ANTHROPIC') NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `status` ENUM('SUCCESS', 'PROVIDER_ERROR', 'TIMEOUT', 'INVALID_OUTPUT') NOT NULL DEFAULT 'SUCCESS',
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `cachedInputTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheWriteTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `reasoningTokens` INTEGER NOT NULL DEFAULT 0,
    `toolCalls` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `latencyMs` INTEGER NOT NULL DEFAULT 0,
    `pricingVersionId` CHAR(26) NULL,
    `pricingSnapshot` JSON NULL,
    `costMicros` BIGINT NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `policyVersionId` CHAR(26) NULL,
    `policySections` JSON NULL,
    `errorCode` VARCHAR(60) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_calls_accountId_createdAt_idx`(`accountId`, `createdAt`),
    INDEX `ai_calls_accountId_provider_model_idx`(`accountId`, `provider`, `model`),
    INDEX `ai_calls_accountId_role_createdAt_idx`(`accountId`, `role`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `execution_traces` (
    `id` CHAR(26) NOT NULL,
    `accountId` CHAR(26) NOT NULL,
    `aiCallId` CHAR(26) NOT NULL,
    `sessionId` CHAR(26) NULL,
    `hubOperationId` CHAR(26) NULL,
    `deploymentId` CHAR(26) NULL,
    `deploymentManifestHash` CHAR(64) NULL,
    `runtimeVersion` VARCHAR(20) NOT NULL,
    `contextCompilerVersion` VARCHAR(20) NOT NULL,
    `promptCompilerVersion` VARCHAR(20) NOT NULL,
    `provider` ENUM('FAKE', 'GEMINI', 'OPENAI', 'ANTHROPIC') NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `generationParams` JSON NOT NULL,
    `contextBlocks` JSON NOT NULL,
    `compiledRequest` JSON NOT NULL,
    `violations` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `execution_traces_aiCallId_key`(`aiCallId`),
    INDEX `execution_traces_accountId_createdAt_idx`(`accountId`, `createdAt`),
    INDEX `execution_traces_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `execution_traces_hubOperationId_idx`(`hubOperationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_calls` ADD CONSTRAINT `ai_calls_pricingVersionId_fkey` FOREIGN KEY (`pricingVersionId`) REFERENCES `ai_model_pricing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `execution_traces` ADD CONSTRAINT `execution_traces_aiCallId_fkey` FOREIGN KEY (`aiCallId`) REFERENCES `ai_calls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
