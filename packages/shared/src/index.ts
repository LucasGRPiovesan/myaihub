/**
 * @myaihub/shared — contratos compartilhados entre api e web.
 *
 * REGRA: este pacote publica apenas CONTRATOS (schemas Zod, tipos, enums).
 * Zero lógica de negócio, zero I/O, zero dependência de runtime específico.
 * Ver docs/ARCHITECTURE.md §2.
 */
export * from './errors.js';
export * from './auth.js';
export * from './pagination.js';
export * from './ai.js';
export * from './hub-events.js';
export * from './canonical/index.js';
export * from './hub.js';
export * from './playbook.js';
export * from './knowledge.js';
export * from './conversations.js';
export * from './metrics.js';
export * from './visual-blocks.js';
