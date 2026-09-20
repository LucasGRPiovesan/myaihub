import { z } from 'zod';

/**
 * Paginação por cursor. Listagens nunca carregam histórico completo (§73).
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
