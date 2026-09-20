/**
 * Identidade da Master Policy do MyAIHub OS.
 *
 * Fica no DOMÍNIO porque é o nome pelo qual o OS pede sua própria policy — não
 * um detalhe de como ela é semeada. O CONTEÚDO da v1 vive em
 * `infrastructure/master-policy.seed.ts`; a partir da primeira gravação, a
 * fonte de verdade é o banco (§27).
 */
export const MASTER_POLICY_NAME = 'myaihub-os';
