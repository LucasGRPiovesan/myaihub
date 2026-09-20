import request from 'supertest';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { closeTestResources, getTestApp, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

/**
 * O gestor de modelos é da PLATAFORMA.
 *
 * Trocar o modelo de um papel muda o custo e o comportamento de TODAS as
 * contas. Quem decide isso é quem administra a plataforma — a mesma fronteira
 * do playbook, que o dono de uma conta também não edita.
 */
describe.skipIf(!enabled)('Gestor de modelos (integração)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function login(role: 'ADMIN' | 'USER') {
    const { app } = getTestApp();
    const email = role === 'ADMIN' ? 'admin.modelos@exemplo.com' : 'user.modelos@exemplo.com';
    const password = 'Senha@123456';

    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Op', email, password, accountName: 'Conta Modelos' })
      .expect(201);

    // O registro cria OWNER da conta; ADMIN de plataforma é outro papel, e é
    // exatamente essa distinção que esta rota cobra.
    if (role === 'ADMIN') {
      await rawDb.user.update({ where: { email }, data: { role: 'ADMIN' } });
    }

    const resposta = await request(app)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return { app, cookies: resposta.get('Set-Cookie') ?? [] };
  }

  it('usuário comum não lê nem escreve a configuração de modelos', async () => {
    const { app, cookies } = await login('USER');

    await request(app).get('/api/admin/models').set('Cookie', cookies).expect(403);
    await request(app)
      .put('/api/admin/models/agent.runtime')
      .set('Cookie', cookies)
      .send({ provider: 'gemini', model: 'gemini-3.5-pro' })
      .expect(403);
  });

  it('o admin lê o catálogo com a disponibilidade vinda da CHAVE', async () => {
    const { app, cookies } = await login('ADMIN');

    const resposta = await request(app).get('/api/admin/models').set('Cookie', cookies).expect(200);

    // Providers sem chave aparecem — desligados, com a variável que falta.
    // Escondê-los daria a entender que não existem, quando o que falta é config.
    const providers = resposta.body.providers as Array<{ provider: string; available: boolean }>;
    expect(providers.map((item) => item.provider)).toEqual(['gemini', 'openai', 'anthropic']);
    expect(providers.find((item) => item.provider === 'openai')?.available).toBe(false);

    expect(resposta.body.roles).toHaveLength(5);
  });

  it('recusa modelo fora do catálogo em vez de deixar o erro estourar no turno seguinte', async () => {
    const { app, cookies } = await login('ADMIN');

    await request(app)
      .put('/api/admin/models/agent.runtime')
      .set('Cookie', cookies)
      .send({ provider: 'gemini', model: 'modelo-que-nao-existe' })
      .expect(422);
  });

  it('recusa provider SEM CHAVE — apontar o papel para ele quebraria o sistema', async () => {
    const { app, cookies } = await login('ADMIN');

    const resposta = await request(app)
      .put('/api/admin/models/agent.runtime')
      .set('Cookie', cookies)
      .send({ provider: 'anthropic', model: 'claude-sonnet-5' })
      .expect(422);

    expect(resposta.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('papel desconhecido é recusado', async () => {
    const { app, cookies } = await login('ADMIN');

    await request(app)
      .put('/api/admin/models/papel.inventado')
      .set('Cookie', cookies)
      .send({ provider: 'gemini', model: 'gemini-3.5-pro' })
      .expect(422);
  });
});
