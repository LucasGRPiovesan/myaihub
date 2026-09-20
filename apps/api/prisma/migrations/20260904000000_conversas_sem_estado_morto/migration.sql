-- Sai o estado de sessão que nada produzia nem consumia.
--
-- `status`, `endedAt` e o evento `SESSION_ENDED` supunham um gatilho de
-- encerramento — job de expiração por inatividade ou ação explícita — e nenhum
-- dos dois existe. Uma coluna que nunca sai de OPEN mente sobre o que o sistema
-- sabe; ela volta junto do gatilho.
--
-- `visitorKey` guardaria um hash de quem está do outro lado no chat público,
-- mas quem separa as conversas é o `sessionId`, e nada lia a coluna. Campo
-- sempre nulo é o mesmo tipo de mentira.

-- AlterTable
ALTER TABLE `conversation_sessions` DROP COLUMN `endedAt`,
    DROP COLUMN `status`,
    DROP COLUMN `visitorKey`;

-- AlterTable
ALTER TABLE `session_events` MODIFY `type` ENUM('SESSION_STARTED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'RULE_VIOLATION', 'CTA_OFFERED', 'OBJECTIVE_REACHED') NOT NULL;
