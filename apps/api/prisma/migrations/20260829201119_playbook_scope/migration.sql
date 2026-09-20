-- AlterTable
ALTER TABLE `hub_conversations` MODIFY `scope` ENUM('ROOT', 'PROJECT', 'AGENT', 'CAMPAIGN', 'PLAYBOOK') NOT NULL;
