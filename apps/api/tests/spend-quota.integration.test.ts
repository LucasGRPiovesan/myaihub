import request from 'supertest';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { closeTestResources, getTestApp, rawDb, resetDatabase } from './helpers/test-context.js';

const enabled = inject('integrationDatabaseReady');

/**
 * A Topbar mostra o que ACONTECEU, não o que o adapter tentaria agora.
 *
 * A primeira versão devolvia o estado em memória do provider, e ele é PREVISÃO:
 * reinicia junto do processo. Depois de um restart o adapter volta a supor que
 * a cota gratuita está de pé, e a tela dizia "cota gratuita" enquanto as
 * chamadas saíam pela paga — medido em desenvolvimento, com as chamadas
 * gravadas em `ai_calls` provando o contrário do que a tela afirmava.
 */
describe.skipIf(!enabled)('Cota exibida (integração)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestResources();
  });

  async function contaLogada() {
    const { app } = getTestApp();
    const email = 'cota@exemplo.com';
    const password = 'Senha@123456';

    const registro = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Op', email, password, accountName: 'Conta Cota' })
      .expect(201);

    const login = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    return {
      app,
      cookies: login.get('Set-Cookie') ?? [],
      accountId: registro.body.user.activeAccount.id as string,
    };
  }

  async function gravarChamada(accountId: string, tier: 'FREE' | 'PAID', quandoMs: number) {
    await rawDb.aiCall.create({
      data: {
        id: `01AICALL${String(quandoMs).padStart(17, '0')}`.slice(0, 26),
        accountId,
        role: 'agent.runtime',
        provider: 'GEMINI',
        model: 'gemini-3.5-flash-lite',
        status: 'SUCCESS',
        totalTokens: 100,
        costMicros: tier === 'PAID' ? 250 : 0,
        pricingSnapshot: { tier },
        createdAt: new Date(quandoMs),
      },
    });
  }

  it('reporta a cota que serviu a ÚLTIMA chamada', async () => {
    const { app, cookies, accountId } = await contaLogada();

    await gravarChamada(accountId, 'FREE', Date.parse('2026-09-05T10:00:00Z'));
    await gravarChamada(accountId, 'PAID', Date.parse('2026-09-05T20:00:00Z'));

    const resposta = await request(app)
      .get('/api/metrics/spend')
      .set('Cookie', cookies)
      .expect(200);

    expect(resposta.body.quota.tier).toBe('PAID');
  });

  it('sem chamada nenhuma, não afirma cota nenhuma', async () => {
    // Melhor não mostrar o badge que mostrar um palpite: em desenvolvimento
    // ele existe justamente para dizer se o dinheiro está saindo.
    const { app, cookies } = await contaLogada();

    const resposta = await request(app)
      .get('/api/metrics/spend')
      .set('Cookie', cookies)
      .expect(200);

    expect(resposta.body.quota?.tier).toBeUndefined();
  });

  it('a chamada GRATUITA entra no total com custo zero', async () => {
    const { app, cookies, accountId } = await contaLogada();

    await gravarChamada(accountId, 'FREE', Date.now());

    const resposta = await request(app)
      .get('/api/metrics/spend')
      .set('Cookie', cookies)
      .expect(200);

    expect(resposta.body.quota.tier).toBe('FREE');
    expect(resposta.body.month.costMicros).toBe(0);
    expect(resposta.body.month.totalTokens).toBe(100);
  });
});
