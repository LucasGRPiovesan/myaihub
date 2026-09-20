import type { AuthSessionResponse } from '@myaihub/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, inject } from 'vitest';
import {
  closeTestResources,
  getTestApp,
  promoteToAdmin,
  rawDb,
  resetDatabase,
} from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

interface Actor {
  token: string;
  accountId: string;
  userId: string;
}

/**
 * Flows 7 e 8 do §72 — isolamento de tenant.
 *
 * O recurso sob teste é a auditoria da conta, o primeiro recurso tenant-scoped
 * do sistema. Todo módulo futuro repete exatamente estes casos.
 */
describe.skipIf(!enabled)('isolamento de tenant (integração)', () => {
  const { app } = getTestApp();

  async function createActor(email: string, options: { admin?: boolean } = {}): Promise<Actor> {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: `Usuário ${email}`, email, password: 'Senha@Forte123' })
      .expect(201);

    const body = response.body as AuthSessionResponse;

    if (options.admin) {
      await promoteToAdmin(email);
      // O papel vive no access token; após a promoção é preciso reautenticar.
      const relogin = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'Senha@Forte123' })
        .expect(200);

      const refreshed = relogin.body as AuthSessionResponse;
      return {
        token: refreshed.accessToken,
        accountId: refreshed.user.activeAccount.id,
        userId: refreshed.user.id,
      };
    }

    return {
      token: body.accessToken,
      accountId: body.user.activeAccount.id,
      userId: body.user.id,
    };
  }

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestResources();
  });

  it('permite que o usuário leia a auditoria da própria conta', async () => {
    const alice = await createActor('alice@exemplo.com');

    const response = await request(app)
      .get(`/api/accounts/${alice.accountId}/audit-logs`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    // O registro de criação da conta já está lá.
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].action).toBe('account.created');
    expect(response.body.items[0].accountId).toBe(alice.accountId);
  });

  // Flow 8
  it('devolve 404 quando um USER tenta ler a conta de outro tenant', async () => {
    const alice = await createActor('alice@exemplo.com');
    const bob = await createActor('bob@exemplo.com');

    const response = await request(app)
      .get(`/api/accounts/${bob.accountId}/audit-logs`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(404);

    // 404 e não 403: para quem não é admin, contas alheias não existem.
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('não vaza nada nem quando o USER manda um motivo de elevação', async () => {
    const alice = await createActor('alice@exemplo.com');
    const bob = await createActor('bob@exemplo.com');

    await request(app)
      .get(`/api/accounts/${bob.accountId}/audit-logs`)
      .set('Authorization', `Bearer ${alice.token}`)
      .set('X-Elevation-Reason', 'quero ver')
      .expect(404);
  });

  it('exige autenticação', async () => {
    const alice = await createActor('alice@exemplo.com');
    await request(app).get(`/api/accounts/${alice.accountId}/audit-logs`).expect(401);
  });

  // Flow 7
  describe('admin', () => {
    it('recusa acesso cross-tenant sem motivo declarado', async () => {
      const admin = await createActor('admin@exemplo.com', { admin: true });
      const bob = await createActor('bob@exemplo.com');

      const response = await request(app)
        .get(`/api/accounts/${bob.accountId}/audit-logs`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(403);

      expect(response.body.error.code).toBe('ELEVATION_REQUIRED');
    });

    it('permite acesso cross-tenant com motivo, e registra a elevação', async () => {
      const admin = await createActor('admin@exemplo.com', { admin: true });
      const bob = await createActor('bob@exemplo.com');

      const response = await request(app)
        .get(`/api/accounts/${bob.accountId}/audit-logs`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-Elevation-Reason', 'investigação de suporte #123')
        .expect(200);

      expect(response.body.items.length).toBeGreaterThan(0);

      const elevation = await rawDb.auditLog.findFirst({
        where: { accountId: bob.accountId, action: 'admin.cross_tenant_access' },
      });

      expect(elevation).not.toBeNull();
      expect(elevation?.actorUserId).toBe(admin.userId);
      expect(elevation?.metadata).toMatchObject({
        reason: 'investigação de suporte #123',
        fromAccountId: admin.accountId,
      });
    });

    it('usa a própria conta normalmente, sem elevação', async () => {
      const admin = await createActor('admin@exemplo.com', { admin: true });

      await request(app)
        .get(`/api/accounts/${admin.accountId}/audit-logs`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const elevations = await rawDb.auditLog.count({
        where: { action: 'admin.cross_tenant_access' },
      });
      expect(elevations).toBe(0);
    });
  });
});
