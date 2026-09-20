-- Os trechos de conhecimento que ENTRARAM no contexto (§8.1).
--
-- O manifest congela QUAL snapshot vale; sem isto, o trace sabia a base e não
-- sabia o que dela foi usado no turno — "reproduzível" ficava pela metade.
--
-- Guarda ids e pontuação, nunca o texto: o conteúdo é do cliente e o trace é
-- lido por operadores.

-- AlterTable
ALTER TABLE `execution_traces` ADD COLUMN `knowledgeRefs` JSON NULL;
