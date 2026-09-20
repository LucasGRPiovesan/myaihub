import type { AuthSessionResponse } from '@myaihub/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { closeTestResources, getTestApp, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

const CREDENTIALS = {
  name: 'Lucas Piovesan',
  email: 'lucas@exemplo.com',
  password: 'Senha@Forte123',
};

/** Os tipos do supertest declaram set-cookie como `string | never[]`; normalizamos. */
function setCookies(response: request.Response): string[] {
  const raw = (response.headers as Record<string, unknown>)['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=')[1];
}

describe.skipIf(!enabled)('auth (integração)', () => {
  const { app } = getTestApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestResources();
  });

  describe('cadastro', () => {
    it('cria usuário, conta própria e sessão', async () => {
      const response = await request(app).post('/api/auth/register').send(CREDENTIALS).expect(201);

      const body = response.body as AuthSessionResponse;
      expect(body.user.email).toBe(CREDENTIALS.email);
      expect(body.user.role).toBe('USER');
      // Todo usuário nasce dono da própria Account — não há caso especial (§47).
      expect(body.user.activeAccount.membershipRole).toBe('OWNER');
      expect(body.accessToken).toBeTruthy();

      const cookies = setCookies(response);
      expect(cookieValue(cookies, 'mah_at')).toBeTruthy();
      expect(cookieValue(cookies, 'mah_rt')).toBeTruthy();
      // O refresh token só trafega para as rotas que o usam.
      expect(cookies.find((cookie) => cookie.startsWith('mah_rt='))).toContain('Path=/api/auth');
      expect(cookies.every((cookie) => cookie.includes('HttpOnly'))).toBe(true);
    });

    it('nunca devolve o hash da senha', async () => {
      const response = await request(app).post('/api/auth/register').send(CREDENTIALS).expect(201);
      expect(JSON.stringify(response.body)).not.toContain('scrypt$');
    });

    it('rejeita e-mail duplicado', async () => {
      await request(app).post('/api/auth/register').send(CREDENTIALS).expect(201);

      const response = await request(app).post('/api/auth/register').send(CREDENTIALS).expect(409);
      expect(response.body.error.code).toBe('EMAIL_ALREADY_IN_USE');
    });

    it('rejeita senha fraca com detalhes de validação', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...CREDENTIALS, password: 'fraca' })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.requestId).toBeTruthy();
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(CREDENTIALS).expect(201);
    });

    it('autentica com credenciais válidas', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: CREDENTIALS.email, password: CREDENTIALS.password })
        .expect(200);

      expect((response.body as AuthSessionResponse).user.email).toBe(CREDENTIALS.email);
    });

    it('devolve o mesmo erro para senha errada e e-mail inexistente', async () => {
      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ email: CREDENTIALS.email, password: 'Outra@Senha123' })
        .expect(401);

      const unknownEmail = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ninguem@exemplo.com', password: 'Outra@Senha123' })
        .expect(401);

      // Mensagens distintas enumerariam usuários cadastrados.
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });
  });

  describe('sessão', () => {
    it('exige autenticação em /auth/me', async () => {
      const response = await request(app).get('/api/auth/me').expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('devolve o usuário atual com cookie de sessão', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(CREDENTIALS).expect(201);

      const response = await agent.get('/api/auth/me').expect(200);
      expect(response.body.user.email).toBe(CREDENTIALS.email);
    });

    it('encerra a sessão no logout', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(CREDENTIALS).expect(201);

      await agent.post('/api/auth/logout').expect(204);
      await agent.post('/api/auth/refresh').expect(401);
    });
  });

  describe('rotação de refresh token', () => {
    it('rotaciona o token a cada renovação', async () => {
      const agent = request.agent(app);
      const registered = await agent.post('/api/auth/register').send(CREDENTIALS).expect(201);
      const firstRefresh = cookieValue(setCookies(registered), 'mah_rt');

      const refreshed = await agent.post('/api/auth/refresh').expect(200);
      const secondRefresh = cookieValue(setCookies(refreshed), 'mah_rt');

      expect(secondRefresh).toBeTruthy();
      expect(secondRefresh).not.toBe(firstRefresh);
    });

    it('revoga TODAS as sessões ao detectar reuso de um token já rotacionado', async () => {
      const agent = request.agent(app);
      const registered = await agent.post('/api/auth/register').send(CREDENTIALS).expect(201);
      const stolen = cookieValue(setCookies(registered), 'mah_rt');

      // O usuário legítimo renova: o token acima passa a ser histórico.
      await agent.post('/api/auth/refresh').expect(200);

      // O atacante tenta usar a cópia que capturou.
      const reuse = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`mah_rt=${stolen}`])
        .expect(401);

      expect(reuse.body.error.code).toBe('TOKEN_INVALID');

      // E a sessão legítima também cai — é o comportamento correto diante de
      // um token comprovadamente vazado.
      await agent.post('/api/auth/refresh').expect(401);

      const active = await rawDb.refreshToken.count({ where: { revokedAt: null } });
      expect(active).toBe(0);
    });
  });
});
