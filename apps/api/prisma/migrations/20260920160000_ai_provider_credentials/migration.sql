-- Ligado/desligado por PROVIDER, decisão do admin — não a presença de chave.
CREATE TABLE `ai_provider_settings` (
  `provider` ENUM('FAKE', 'GEMINI', 'OPENAI', 'ANTHROPIC') NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `updatedBy` CHAR(26) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- As chaves de cada provider, cifradas — AES-256-GCM, chave de cifra derivada
-- de JWT_ACCESS_SECRET, nunca gravada. Seedada do .env no primeiro boot.
CREATE TABLE `ai_provider_credentials` (
  `provider` ENUM('FAKE', 'GEMINI', 'OPENAI', 'ANTHROPIC') NOT NULL,
  `kind` ENUM('DEFAULT', 'FREE', 'PAID') NOT NULL,
  `apiKeyCipher` VARCHAR(600) NOT NULL,
  `updatedBy` CHAR(26) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`provider`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
