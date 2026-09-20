-- Rota de modelo por PAPEL, editável pelo admin da plataforma.
--
-- Sem accountId de propósito: é configuração da PLATAFORMA, como a Master
-- Policy e os playbooks. Linha ausente significa "vale o padrão da env", que é
-- o que faz o sistema subir num banco que nunca teve a tela aberta.
CREATE TABLE `model_routes` (
  `role` VARCHAR(40) NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `model` VARCHAR(120) NOT NULL,
  `updatedBy` CHAR(26) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
