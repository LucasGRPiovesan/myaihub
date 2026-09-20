import { describe, expect, it } from 'vitest';
import { runWithTenantContext, systemTenantContext } from '../../application/tenant-context.js';
import { TenantScopeMissingError } from '../../domain/errors.js';
import { assertTenantScoped } from './tenant-guard.js';

const ACCOUNT = '01J000000000000000000ACCT';

describe('tenantGuard', () => {
  describe('modelos UNSCOPED', () => {
    it('permite busca por e-mail no login, que acontece antes de existir tenant', () => {
      expect(() =>
        assertTenantScoped('User', 'findUnique', { where: { email: 'a@b.com' } }),
      ).not.toThrow();
    });

    it('permite resolver membership por userId', () => {
      expect(() =>
        assertTenantScoped('AccountMembership', 'findMany', { where: { userId: 'u1' } }),
      ).not.toThrow();
    });
  });

  describe('modelos TENANT_SCOPED', () => {
    it('rejeita leitura sem accountId', () => {
      expect(() => assertTenantScoped('AuditLog', 'findMany', { where: {} })).toThrow(
        TenantScopeMissingError,
      );
    });

    it('rejeita findUnique por id — é exatamente o padrão que abre IDOR', () => {
      expect(() => assertTenantScoped('AuditLog', 'findUnique', { where: { id: 'x' } })).toThrow(
        TenantScopeMissingError,
      );
    });

    it('aceita quando accountId está no where', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'findMany', { where: { accountId: ACCOUNT } }),
      ).not.toThrow();
    });

    it('aceita accountId dentro de AND', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'findFirst', {
          where: { AND: [{ accountId: ACCOUNT }, { action: 'x' }] },
        }),
      ).not.toThrow();
    });

    it('aceita accountId com filtro composto (in)', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'count', { where: { accountId: { in: [ACCOUNT] } } }),
      ).not.toThrow();
    });

    it('rejeita create sem accountId no data', () => {
      expect(() => assertTenantScoped('AuditLog', 'create', { data: { action: 'x' } })).toThrow(
        TenantScopeMissingError,
      );
    });

    it('aceita create com accountId', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'create', { data: { accountId: ACCOUNT, action: 'x' } }),
      ).not.toThrow();
    });

    it('aceita create com relação conectada', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'create', {
          data: { account: { connect: { id: ACCOUNT } }, action: 'x' },
        }),
      ).not.toThrow();
    });

    it('rejeita createMany quando algum item vem sem accountId', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'createMany', {
          data: [{ accountId: ACCOUNT }, { action: 'x' }],
        }),
      ).toThrow(TenantScopeMissingError);
    });

    it('rejeita createMany vazio em vez de tratá-lo como válido', () => {
      expect(() => assertTenantScoped('AuditLog', 'createMany', { data: [] })).toThrow(
        TenantScopeMissingError,
      );
    });

    it('exige accountId nos dois lados do upsert', () => {
      expect(() =>
        assertTenantScoped('AuditLog', 'upsert', {
          where: { accountId: ACCOUNT, id: 'x' },
          create: { action: 'x' },
        }),
      ).toThrow(TenantScopeMissingError);
    });
  });

  describe('falha fechada', () => {
    it('rejeita modelo não classificado em tenant-policy.ts', () => {
      expect(() =>
        assertTenantScoped('ModeloQueAlguemCriouSemClassificar', 'findMany', { where: {} }),
      ).toThrow(TenantScopeMissingError);
    });

    it('rejeita operação desconhecida em modelo tenant-scoped', () => {
      expect(() => assertTenantScoped('AuditLog', 'operacaoNova', {})).toThrow(
        TenantScopeMissingError,
      );
    });
  });

  describe('escopo elevado', () => {
    it('permite acesso cross-tenant apenas dentro de um contexto elevado', () => {
      expect(() => assertTenantScoped('AuditLog', 'findMany', { where: {} })).toThrow();

      runWithTenantContext(systemTenantContext('teste'), () => {
        expect(() => assertTenantScoped('AuditLog', 'findMany', { where: {} })).not.toThrow();
      });

      // E a elevação não vaza para fora do escopo.
      expect(() => assertTenantScoped('AuditLog', 'findMany', { where: {} })).toThrow();
    });
  });
});
